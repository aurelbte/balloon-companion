import assert from "node:assert/strict";
import test from "node:test";

import { CloudBackfillService, cloudBackfillKey } from "./cloudBackfillService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { CloudSyncService, MemoryCloudSyncIssueRepository } from "./cloudSyncService.ts";

const scope = "USER:user-a";
const logbook = { entityType: "logbook-entry", entityId: "entry-old" };

function fixture({ candidates = [logbook], existing = [], online = true, currentScope = scope, outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => "mutation-1", now: () => "2026-08-27T10:00:00.000Z" } }) } = {}) {
  let activeScope = currentScope;
  const service = new CloudBackfillService({
    scope,
    getScope: () => activeScope,
    isOnline: () => online,
    getOnlineUserId: async () => activeScope === scope ? "user-a" : "user-b",
    listCandidates: async () => candidates,
    findExistingCloud: async () => new Set(existing.map(cloudBackfillKey)),
    outbox,
  });
  return { service, outbox, switchUser: () => { activeScope = "USER:user-b"; } };
}

test("ancien logbook local absent Cloud crée un seul UPSERT et le second passage est idempotent", async () => {
  const ctx = fixture();
  const first = await ctx.service.run();
  const second = await ctx.service.run();
  assert.equal(first.enqueued, 1);
  assert.equal(second.enqueued, 0);
  assert.equal(second.pendingPreserved, 1);
  assert.deepEqual((await ctx.outbox.list()).map(({ entityType, entityId, operation, baseRevision }) => ({ entityType, entityId, operation, baseRevision })), [{ ...logbook, operation: "UPSERT", baseRevision: 0 }]);
});

test("une ligne Cloud existante, même plus récente, est préservée sans mutation locale", async () => {
  const ctx = fixture({ existing: [logbook] });
  const report = await ctx.service.run();
  assert.equal(report.cloudExistingPreserved, 1);
  assert.deepEqual(await ctx.outbox.list(), []);
});

test("un sidecar historique de favori météo ne masque pas une ligne Cloud réellement absente", async () => {
  const candidate = { entityType: "favorite-weather-place", entityId: "bondues", verifyCloudPresence: true };
  const ctx = fixture({ candidates: [candidate] });
  await ctx.outbox.setMetadata({ entityType: candidate.entityType, entityId: candidate.entityId, revision: 2, updatedAt: "2026-08-20T10:00:00.000Z" });
  const report = await ctx.service.run();
  assert.equal(report.enqueued, 1);
  const [mutation] = await ctx.outbox.list();
  assert.equal(mutation.entityType, "favorite-weather-place");
  assert.equal(mutation.entityId, "bondues");
  assert.equal(mutation.baseRevision, 0);
});

test("un favori météo vérifié présent dans Cloud n'est jamais dupliqué", async () => {
  const candidate = { entityType: "favorite-weather-place", entityId: "bondues", verifyCloudPresence: true };
  const ctx = fixture({ candidates: [candidate], existing: [candidate] });
  await ctx.outbox.setMetadata({ entityType: candidate.entityType, entityId: candidate.entityId, revision: 1, updatedAt: "2026-08-20T10:00:00.000Z" });
  const report = await ctx.service.run();
  assert.equal(report.cloudExistingPreserved, 1);
  assert.equal((await ctx.outbox.list()).length, 0);
});

test("Bondues local absent du Cloud est backfillé puis poussé une seule fois", async () => {
  const candidate = { entityType: "favorite-weather-place", entityId: "bondues", verifyCloudPresence: true };
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => "mutation-bondues", now: () => "2026-08-27T10:00:00.000Z" } });
  const cloud = new Map();
  const backfill = fixture({ candidates: [candidate], outbox });

  assert.equal((await backfill.service.run()).enqueued, 1);
  assert.deepEqual((await outbox.list()).map(({ entityType, entityId, operation }) => ({ entityType, entityId, operation })), [{ entityType: "favorite-weather-place", entityId: "bondues", operation: "UPSERT" }]);

  const push = new CloudSyncService({
    outbox,
    issues: new MemoryCloudSyncIssueRepository(),
    getScope: () => scope,
    getOnlineUserId: async () => "user-a",
    buildPayload: async (mutation) => ({ serverEntityType: "favorite_weather_place", serverEntityId: mutation.entityId, payload: { name: "Bondues", latitude: 50.7, longitude: 3.1 } }),
    applyMutation: async (request) => {
      cloud.set(request.entityId, request.payload);
      return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: "2026-08-27T10:00:01.000Z", deletedAt: null };
    },
    now: () => new Date("2026-08-27T10:00:01.000Z"),
  });
  assert.equal((await push.syncPendingMutations()).applied, 1);
  assert.deepEqual(cloud.get("bondues"), { name: "Bondues", latitude: 50.7, longitude: 3.1 });
  assert.equal((await outbox.list()).length, 0);
});

test("offline ne crée rien et un passage online peut reprendre", async () => {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => "mutation-resume" } });
  assert.equal((await fixture({ online: false, outbox }).service.run()).state, "OFFLINE");
  assert.deepEqual(await outbox.list(), []);
  assert.equal((await fixture({ online: true, outbox }).service.run()).enqueued, 1);
});

test("interruption conserve le premier UPSERT et la reprise complète sans doublon", async () => {
  const base = new MemorySyncOutboxStorage({ dependencies: { createId: (() => { let id = 0; return () => `mutation-${++id}`; })() } });
  let calls = 0;
  const interrupted = { ...base, list: () => base.list(), getMetadata: (type, id) => base.getMetadata(type, id), enqueue: async (value) => { calls += 1; if (calls === 2) throw new Error("interrupted"); return base.enqueue(value); } };
  const candidates = [logbook, { entityType: "flight", entityId: "flight-old" }];
  assert.equal((await fixture({ candidates, outbox: interrupted }).service.run()).state, "STOPPED_ERROR");
  assert.equal((await base.list()).length, 1);
  assert.equal((await fixture({ candidates, outbox: base }).service.run()).enqueued, 1);
  assert.equal((await base.list()).length, 2);
});

test("USER switch pendant le backfill arrête avant l'entité suivante", async () => {
  const base = new MemorySyncOutboxStorage({ dependencies: { createId: () => "mutation-first" } });
  let ctx;
  const guarded = { ...base, list: () => base.list(), getMetadata: (type, id) => base.getMetadata(type, id), enqueue: async (value) => { const mutation = await base.enqueue(value); ctx.switchUser(); return mutation; } };
  ctx = fixture({ candidates: [logbook, { entityType: "flight", entityId: "flight-old" }], outbox: guarded });
  const report = await ctx.service.run();
  assert.equal(report.state, "SESSION_INVALID");
  assert.equal((await base.list()).length, 1);
});

test("wiring navigateur couvre tous les domaines sans points GPS ni full scan Cloud", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./cloudBackfillBrowser.ts", import.meta.url), "utf8");
  for (const entityType of ["pilot-profile", "pilot-qualifications", "unit-preferences", "weather-preferences", "aviation-preferences", "favorite-weather-place", "favorite-launch-site", "balloon", "balloon-preferences", "flight", "logbook-entry", "balloon-document"]) assert.match(source, new RegExp(`entityType: \\"${entityType}\\"|entityType === \\"${entityType}\\"`));
  assert.match(source, /\.in\("id", batch\.map/);
  assert.doesNotMatch(source, /points|trace|syncPendingMutations|\.rpc\(/i);
});

test("runtime et page Plus réutilisent le contrôleur pour backfill, PUSH, PULL et queue trace", async () => {
  const fs = await import("node:fs/promises");
  const runtime = await fs.readFile(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  const more = await fs.readFile(new URL("../more/page.tsx", import.meta.url), "utf8");
  assert.match(runtime, /createBrowserCloudBackfillService[\s\S]*report\.state === "SUCCESS"/);
  assert.match(runtime, /backfill\.state !== "COMPLETED"[\s\S]*repairBrowserFavoriteWeatherIdentityCollisions/);
  assert.match(runtime, /synchronizeCloudNowThroughRuntimeController/);
  assert.match(runtime, /discoverPendingJobs[\s\S]*drainFlightTrackQueue/);
  assert.match(runtime, /discoverMissingDownloadJobs[\s\S]*drainFlightTrackQueue/);
  assert.match(more, /Synchroniser maintenant/);
  assert.match(more, /synchronizeCloudNowThroughRuntimeController/);
  assert.doesNotMatch(more, /syncPendingMutations|\.rpc\(|syncMutationById|drainFlightTrackQueue/);
});
