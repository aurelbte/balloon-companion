import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CLOUD_BOOTSTRAP_DOMAIN_ORDER, CloudBootstrapService } from "./cloudBootstrapService.ts";

const scope = "USER:user-1";
const now = "2026-08-24T10:00:00.000Z";
const completed = (overrides = {}) => ({ state: "COMPLETED", fetched: 1, applied: 1, tombstonesApplied: 0, preservedLocalPending: 0, conflicts: [], anomalies: [], pages: 1, cursor: { updatedAt: now, id: "a" }, ...overrides });

function context(overrides = {}) {
  const calls = [];
  const reports = Object.fromEntries(CLOUD_BOOTSTRAP_DOMAIN_ORDER.map((domain) => [domain, completed()]));
  let currentScope = scope, user = "user-1", online = true;
  const outbox = [{ mutationId: "existing", entityType: "flight", entityId: "local", operation: "UPSERT", baseRevision: 1, createdAt: now, attempts: 0 }];
  const pulls = Object.fromEntries(CLOUD_BOOTSTRAP_DOMAIN_ORDER.map((domain) => [domain, async () => { calls.push(domain); return reports[domain]; }]));
  const deps = {
    scope,
    getScope: () => currentScope,
    getOnlineUserId: async () => user,
    isOnline: () => online,
    listOutbox: async () => structuredClone(outbox),
    pulls,
    now: () => now,
    ...overrides,
  };
  return { deps, calls, reports, outbox, setScope: (value) => { currentScope = value; }, setUser: (value) => { user = value; }, setOnline: (value) => { online = value; } };
}

test("appareil vierge suit l'ordre exact et agrège un SUCCESS", async () => {
  const ctx = context();
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "SUCCESS");
  assert.deepEqual(ctx.calls, [...CLOUD_BOOTSTRAP_DOMAIN_ORDER]);
  assert.equal(ctx.calls[0], "profile");
  assert.ok(ctx.calls.indexOf("balloons") < ctx.calls.indexOf("flights"));
  assert.ok(ctx.calls.indexOf("favoriteWeatherPlaces") < ctx.calls.indexOf("favoriteLaunchSites"));
  assert.ok(ctx.calls.indexOf("favoriteLaunchSites") < ctx.calls.indexOf("balloons"));
  assert.ok(ctx.calls.indexOf("balloons") < ctx.calls.indexOf("documents"));
  assert.ok(ctx.calls.indexOf("flights") < ctx.calls.indexOf("logbookEntries"));
  assert.deepEqual(report.totals, { fetched: 10, applied: 10, tombstonesApplied: 0, preservedLocalPending: 0, conflicts: 0, anomalies: 0 });
  assert.equal(report.outboxPreserved, true);
  assert.equal(report.resumable, false);
});

test("pending et conflit sont agrégés en PARTIAL sans écrasement et les domaines suivants continuent", async () => {
  const ctx = context();
  ctx.reports.weatherPreferences = completed({ applied: 0, preservedLocalPending: 1 });
  ctx.reports.favoriteWeatherPlaces = completed({ applied: 0, conflicts: [{ entityId: "x", reason: "REMOTE_ADVANCED", cloudRevision: 2, mutationId: "m" }] });
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "PARTIAL");
  assert.equal(report.totals.preservedLocalPending, 1);
  assert.equal(report.totals.conflicts, 1);
  assert.deepEqual(ctx.calls, [...CLOUD_BOOTSTRAP_DOMAIN_ORDER]);
  assert.equal(report.outboxPreserved, true);
});

test("anomalie balloon bloque immédiatement flights, logbook et documents", async () => {
  const ctx = context();
  ctx.reports.balloons = completed({ state: "BLOCKED_ANOMALY", applied: 0, anomalies: [{ entityId: "b", reason: "LOCAL_DEPENDENCY", cloudRevision: 2, localRevision: 1 }] });
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "BLOCKED");
  assert.equal(report.stoppedAtDomain, "balloons");
  assert.deepEqual(ctx.calls, ["profile", "unitPreferences", "weatherPreferences", "aviationPreferences", "favoriteWeatherPlaces", "favoriteLaunchSites", "balloons"]);
  assert.equal(report.domains.flights, undefined);
  assert.equal(report.totals.anomalies, 1);
});

test("offline avant démarrage vérifie seulement l'outbox locale et ne lance aucun domaine", async () => {
  let outboxReads = 0;
  const ctx = context({ isOnline: () => false, listOutbox: async () => { outboxReads += 1; return []; } });
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "OFFLINE");
  assert.deepEqual(ctx.calls, []);
  assert.equal(outboxReads, 2);
});

test("offline en cours arrête avant le domaine suivant et reste reprenable", async () => {
  const ctx = context();
  ctx.deps.pulls.unitPreferences = async () => { ctx.calls.push("unitPreferences"); ctx.setOnline(false); return completed(); };
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "OFFLINE");
  assert.equal(report.stoppedAtDomain, "weatherPreferences");
  assert.equal(report.resumable, true);
  assert.deepEqual(ctx.calls, ["profile", "unitPreferences"]);
});

test("GUEST, session expirée et USER switch sont refusés", async () => {
  const guest = context(); guest.deps.scope = "GUEST"; guest.setScope("GUEST");
  assert.equal((await new CloudBootstrapService(guest.deps).bootstrapCloudDataForCurrentUser()).state, "SESSION_INVALID");
  const expired = context(); expired.setUser(null);
  assert.equal((await new CloudBootstrapService(expired.deps).bootstrapCloudDataForCurrentUser()).state, "SESSION_INVALID");
  const switched = context(); switched.deps.pulls.unitPreferences = async () => { switched.calls.push("unitPreferences"); switched.setScope("USER:user-2"); return completed(); };
  const report = await new CloudBootstrapService(switched.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "SESSION_INVALID");
  assert.equal(report.stoppedAtDomain, "weatherPreferences");
  assert.deepEqual(switched.calls, ["profile", "unitPreferences"]);
});

test("échec d'un domaine est PARTIAL et une reprise rejoue sans rollback global", async () => {
  const ctx = context();
  let fail = true;
  ctx.deps.pulls.flights = async () => { ctx.calls.push("flights"); if (fail) throw new Error("network"); return completed({ applied: 0, fetched: 0 }); };
  const first = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(first.state, "PARTIAL");
  assert.equal(first.stoppedAtDomain, "flights");
  fail = false; ctx.calls.length = 0;
  const second = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(second.state, "SUCCESS");
  assert.deepEqual(ctx.calls, [...CLOUD_BOOTSTRAP_DOMAIN_ORDER]);
  assert.equal(second.domains.flights.applied, 0);
});

test("profile et favorite_launch_site sont intégrés au bootstrap", async () => {
  const report = await new CloudBootstrapService(context().deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.domains.favoriteLaunchSites.state, "COMPLETED");
  assert.equal(report.domains.profile.state, "COMPLETED");
});

test("toute mutation créée pendant hydratation bloque le verdict et préserve l'ancienne", async () => {
  const ctx = context();
  ctx.deps.pulls.unitPreferences = async () => { ctx.calls.push("unitPreferences"); ctx.outbox.push({ mutationId: "unexpected", entityType: "unit-preferences", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 }); return completed(); };
  const report = await new CloudBootstrapService(ctx.deps).bootstrapCloudDataForCurrentUser();
  assert.equal(report.state, "BLOCKED");
  assert.equal(report.outboxPreserved, false);
  assert.ok(ctx.outbox.some(({ mutationId }) => mutationId === "existing"));
});

test("helpers DEV et orchestration ne déclenchent aucun PUSH ni auto-bootstrap", () => {
  const service = readFileSync(new URL("./cloudBootstrapService.ts", import.meta.url), "utf8");
  const browser = readFileSync(new URL("./cloudBootstrapBrowser.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  for (const source of [service, browser]) assert.doesNotMatch(source, /syncPendingMutations|syncMutationById|enqueueLocalSyncMutation|\.rpc\(|\.insert\(|\.upsert\(/);
  assert.match(runtime, /bootstrapCloudDataTargeted/);
  assert.match(runtime, /inspectCloudBootstrapState/);
  const inspection = runtime.match(/async function inspectCloudBootstrapState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /syncPendingMutations|syncMutationById|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]|getDocumentFile/);
  const schedule = runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "";
  assert.doesNotMatch(schedule, /bootstrapCloudData|pullFavorite|pullBalloons|pullFlights|pullDocuments|pullLogbook/);
});
