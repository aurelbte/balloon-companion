import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { applyBalloonFromCloudWithoutEnqueue, BALLOON_REGISTRY_STORAGE_KEY } from "./balloonStorage.ts";
import { CloudPullService } from "./cloudPullService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const scope = "USER:user-1";
const now = "2026-08-23T15:00:00.000Z";
const value = (overrides = {}) => ({ id: "balloon-a", registration: "F-BCPL", manufacturer: "BC", model: "PULL TEST", category: "Libre à air chaud", volumeM3: 3000, applicableMtowKg: 900, configurationLimitsConfirmed: true, color: "Bleu", isFavorite: true, lastUsedAt: now, weights: { envelopeKg: 100, basketKg: 80, burnerKg: 40, fullCylinders: [] }, deletedAt: null, ...overrides });
const row = (overrides = {}) => ({ id: "balloon-a", entityId: "balloon-a", userId: "user-1", revision: 0, createdAt: now, updatedAt: now, deletedAt: null, value: value(), ...overrides });

class Cursors {
  values = new Map();
  async get(_scope, domain) { return this.values.get(domain) ?? null; }
  async set(_scope, domain, cursor) { this.values.set(domain, cursor); }
}

function context(rows = [row()], blockingDependency = false) {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => crypto.randomUUID(), now: () => now } });
  const cursors = new Cursors();
  const applied = [], conflicts = [];
  let currentScope = scope, user = "user-1", checks = 0, switchAt = Infinity;
  const deps = {
    scope,
    getScope: () => (++checks >= switchAt ? "USER:user-2" : currentScope),
    getOnlineUserId: async () => user,
    outbox,
    cursors,
    readPage: async () => [],
    applyLocally: () => false,
    balloonDomain: {
      readPage: async (cursor, limit) => rows.filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit),
      applyLocally: async (cloud) => { applied.push(cloud); return true; },
      hasBlockingLocalDependency: async (cloud) => Boolean(cloud.deletedAt) && blockingDependency,
    },
    recordConflict: async (conflict) => conflicts.push(conflict),
  };
  return { deps, outbox, cursors, applied, conflicts, switchUserAt: (at) => { switchAt = at; }, setUser: (id) => { user = id; }, setScope: (next) => { currentScope = next; } };
}

test("Cloud actif insère puis met à jour silencieusement avec ID exact et sans enqueue", () => {
  const values = new Map(), events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, item) => values.set(key, item), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "pull@example.test", firstName: "", lastName: "" } });
  assert.equal(applyBalloonFromCloudWithoutEnqueue(scope, value(), storage), true);
  assert.equal(applyBalloonFromCloudWithoutEnqueue(scope, value({ model: "UPDATED" }), storage), true);
  const registry = JSON.parse(values.get(scopedBusinessStorageKey(scope, BALLOON_REGISTRY_STORAGE_KEY)));
  assert.deepEqual(registry.balloons.map(({ id, model }) => ({ id, model })), [{ id: "balloon-a", model: "UPDATED" }]);
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("pull actif pose le sidecar, garde l'outbox intacte et le pull répété est idempotent", async () => {
  const ctx = context();
  await ctx.outbox.enqueue({ entityType: "flight", entityId: "unrelated", operation: "UPSERT" });
  const service = new CloudPullService(ctx.deps);
  assert.equal((await service.pullBalloons()).applied, 1);
  assert.equal((await service.pullBalloons()).applied, 0);
  assert.equal(ctx.applied.length, 1);
  assert.deepEqual(await ctx.outbox.getMetadata("balloon", "balloon-a"), { entityType: "balloon", entityId: "balloon-a", revision: 0, updatedAt: now });
  assert.deepEqual((await ctx.outbox.list()).map(({ entityType }) => entityType), ["flight"]);
});

test("tombstone sans dépendance s'applique, avec dépendance bloque sans cascade ni curseur", async () => {
  const cloud = row({ revision: 2, deletedAt: now, value: value({ deletedAt: now }) });
  const safe = context([cloud]);
  assert.equal((await new CloudPullService(safe.deps).pullBalloons()).tombstonesApplied, 1);
  assert.equal((await safe.outbox.getMetadata("balloon", "balloon-a")).deletedAt, now);
  const blocked = context([cloud], true);
  const result = await new CloudPullService(blocked.deps).pullBalloons();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "LOCAL_DEPENDENCY");
  assert.equal(blocked.applied.length, 0);
  assert.equal(blocked.cursors.values.has("balloon"), false);
});

test("pending égal est préservé; distant avancé, tombstone pending et collision sont des conflits", async () => {
  const equal = context([row({ revision: 2 })]);
  await equal.outbox.setMetadata({ entityType: "balloon", entityId: "balloon-a", revision: 2, updatedAt: now });
  await equal.outbox.enqueue({ entityType: "balloon", entityId: "balloon-a", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(equal.deps).pullBalloons()).preservedLocalPending, 1);
  for (const scenario of [
    { cloud: row({ revision: 2 }), sidecar: 1, reason: "REMOTE_ADVANCED" },
    { cloud: row({ revision: 1, deletedAt: now }), sidecar: 1, reason: "REMOTE_TOMBSTONE" },
    { cloud: row(), sidecar: null, reason: "LOCAL_CREATION_COLLISION" },
  ]) {
    const ctx = context([scenario.cloud]);
    if (scenario.sidecar !== null) {
      await ctx.outbox.setMetadata({ entityType: "balloon", entityId: "balloon-a", revision: scenario.sidecar, updatedAt: now });
      await ctx.outbox.enqueue({ entityType: "balloon", entityId: "balloon-a", operation: "UPSERT", baseRevision: scenario.sidecar });
    } else {
      const historical = { mutationId: "collision", entityType: "balloon", entityId: "balloon-a", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 };
      ctx.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[historical.mutationId, historical]]) });
    }
    assert.equal((await new CloudPullService(ctx.deps).pullBalloons()).conflicts[0].reason, scenario.reason);
    assert.equal(ctx.applied.length, 0);
  }
});

test("révision Cloud derrière sidecar bloque sans rebase", async () => {
  const ctx = context([row({ revision: 1 })]);
  await ctx.outbox.setMetadata({ entityType: "balloon", entityId: "balloon-a", revision: 2, updatedAt: now });
  const result = await new CloudPullService(ctx.deps).pullBalloons();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "REMOTE_REVISION_BEHIND_LOCAL");
  assert.equal(ctx.applied.length, 0);
});

test("pagination déterministe conserve les IDs au même timestamp", async () => {
  const rows = ["a", "b", "c"].map((id) => row({ id, entityId: id, value: value({ id }) }));
  const ctx = context(rows);
  const result = await new CloudPullService(ctx.deps).pullBalloons(2);
  assert.equal(result.applied, 3);
  assert.deepEqual(result.cursor, { updatedAt: now, id: "c" });
});

test("GUEST, session expirée et USER switch sont protégés", async () => {
  const guest = context(); guest.deps.scope = "GUEST"; guest.setScope("GUEST");
  assert.equal((await new CloudPullService(guest.deps).pullBalloons()).state, "REFUSED_GUEST");
  const expired = context(); expired.setUser(null);
  assert.equal((await new CloudPullService(expired.deps).pullBalloons()).state, "REFUSED_NO_SESSION");
  const switched = context(); switched.switchUserAt(4);
  assert.equal((await new CloudPullService(switched.deps).pullBalloons()).state, "STOPPED_USER_SWITCH");
  assert.equal(switched.applied.length, 0);
});

test("adaptateur, helpers ciblés et inspection restent sans PUSH ni auto-pull", () => {
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(browser, /from\("balloons"\)[\s\S]*?\.select\("id,user_id,revision,created_at,updated_at,deleted_at,registration,display_name,manufacturer,model,category,volume_m3,applicable_mtom_kg,configuration_limits_confirmed,color,weights,is_favorite,last_used_at"\)/);
  assert.match(browser, /countByBalloonId/);
  assert.doesNotMatch(browser, /deleteByBalloonId|\.rpc\(|\.insert\(|\.upsert\(|syncMutationById|syncPendingMutations/);
  for (const helper of ["pullBalloonsTargeted", "inspectBalloonPullState"]) assert.match(runtime, new RegExp(helper));
  const inspection = runtime.match(/async function inspectBalloonPullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
  assert.doesNotMatch(runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "", /pullBalloons/);
});
