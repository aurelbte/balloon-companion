import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import { CloudPullService, CloudPullTechnicalError } from "./cloudPullService.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue, FAVORITE_WEATHER_PLACES_STORAGE_KEY } from "./favoriteWeatherPlaces.ts";
import { applyFavoriteLaunchSiteFromCloudWithoutEnqueue, FAVORITE_LAUNCH_SITES_STORAGE_KEY } from "./favoriteLaunchSites.ts";
import { applyPilotProfileFromCloudWithoutEnqueue, PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import { applyOpeningBalanceFromCloudWithoutEnqueue, FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";
import { createEmptyFlightCompletionState } from "./flightCompletion.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const scope = "USER:user-1";
const timestamp = "2026-08-23T12:00:00.000Z";
const row = (overrides = {}) => ({
  id: "weather-a",
  userId: "user-1",
  syncId: null,
  name: "Lille",
  latitude: 50.63,
  longitude: 3.06,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  ...overrides,
});

class MemoryCursorRepository {
  cursor = null;
  failOnId = null;
  async get() { return this.cursor; }
  async set(_scope, _domain, cursor) {
    if (cursor.id === this.failOnId) throw new Error("cursor failed");
    this.cursor = cursor;
  }
}

function dependencies(rows = [row()]) {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => crypto.randomUUID(), now: () => timestamp } });
  const cursors = new MemoryCursorRepository();
  const applied = [];
  const conflicts = [];
  let currentScope = scope;
  let onlineUserId = "user-1";
  let readCalls = 0;
  const deps = {
    scope,
    getScope: () => currentScope,
    getOnlineUserId: async () => onlineUserId,
    outbox,
    cursors,
    readPage: async (cursor, limit) => {
      readCalls += 1;
      return rows.filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit);
    },
    applyLocally: async (cloud) => { applied.push(cloud); return true; },
    recordConflict: async (conflict) => { conflicts.push(conflict); },
  };
  return { deps, outbox, cursors, applied, conflicts, setScope: (value) => { currentScope = value; }, setOnlineUserId: (value) => { onlineUserId = value; }, readCalls: () => readCalls };
}

function launchDependencies(rows = [row({ id: "launch-a" })]) {
  const context = dependencies(rows.map((candidate) => ({ ...candidate, entityId: candidate.id })));
  context.deps.favoriteLaunchSiteDomain = {
    readPage: context.deps.readPage,
    applyLocally: context.deps.applyLocally,
  };
  return context;
}

function profileDependencies(rows = [row({ id: "profile", entityId: "singleton" })]) {
  const context = dependencies(rows.map((candidate) => ({ ...candidate, id: "profile", entityId: "singleton" })));
  context.deps.profileDomain = { readPage: context.deps.readPage, applyLocally: context.deps.applyLocally };
  return context;
}

test("pilot-profile restaure le singleton, gère l'absence et protège le pending", async () => {
  const restored = profileDependencies();
  const report = await new CloudPullService(restored.deps).pullPilotProfile();
  assert.equal(report.applied, 1);
  assert.deepEqual(await restored.outbox.getMetadata("pilot-profile", "singleton"), {
    entityType: "pilot-profile", entityId: "singleton", revision: 0, updatedAt: timestamp,
  });
  assert.deepEqual(await restored.outbox.list(), []);

  const absent = profileDependencies([]);
  assert.deepEqual(await new CloudPullService(absent.deps).pullPilotProfile(), {
    state: "COMPLETED", fetched: 0, applied: 0, tombstonesApplied: 0, preservedLocalPending: 0,
    conflicts: [], anomalies: [], pages: 1, cursor: null,
  });

  const pending = profileDependencies([row({ id: "profile", entityId: "singleton", revision: 2 })]);
  await pending.outbox.setMetadata({ entityType: "pilot-profile", entityId: "singleton", revision: 2, updatedAt: timestamp });
  await pending.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(pending.deps).pullPilotProfile()).preservedLocalPending, 1);
  assert.equal(pending.applied.length, 0);
});

test("pilot-profile protège conflit, USER switch et logout", async () => {
  const conflict = profileDependencies([row({ id: "profile", entityId: "singleton", revision: 2 })]);
  await conflict.outbox.setMetadata({ entityType: "pilot-profile", entityId: "singleton", revision: 1, updatedAt: timestamp });
  await conflict.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT", baseRevision: 1 });
  assert.equal((await new CloudPullService(conflict.deps).pullPilotProfile()).conflicts[0].reason, "REMOTE_ADVANCED");

  const switched = profileDependencies();
  let checks = 0;
  switched.deps.getScope = () => (++checks >= 4 ? "USER:user-2" : scope);
  assert.equal((await new CloudPullService(switched.deps).pullPilotProfile()).state, "STOPPED_USER_SWITCH");

  const logout = profileDependencies();
  logout.setScope(null);
  assert.equal((await new CloudPullService(logout.deps).pullPilotProfile()).state, "REFUSED_NO_SESSION");
});

test("l'import silencieux profile restaure identité et solde initial sans enqueue", () => {
  const values = new Map(), events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "test@example.test", firstName: "", lastName: "" } });
  storage.setItem(scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY), JSON.stringify(createEmptyFlightCompletionState()));
  const profile = { version: 1, firstName: "Ada", lastName: "Lovelace", licenseNumber: "bpl-1", usualFunction: "Pilote", flightTestDueDateIso: "2027-01-02", medicalDueDateIso: "2027-03-04" };
  assert.equal(applyPilotProfileFromCloudWithoutEnqueue(scope, profile, storage), true);
  assert.equal(applyOpeningBalanceFromCloudWithoutEnqueue(scope, { confirmed: true, ascensions: 12, officialDurationMinutes: 345 }, storage), true);
  assert.equal(JSON.parse(values.get(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY))).licenseNumber, "BPL-1");
  assert.equal(applyPilotProfileFromCloudWithoutEnqueue(scope, { ...profile, firstName: "Grace", licenseNumber: "bpl-2" }, storage), true);
  assert.deepEqual(JSON.parse(values.get(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY))).firstName, "Grace");
  assert.deepEqual(JSON.parse(values.get(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY))).licenseNumber, "BPL-2");
  assert.deepEqual(JSON.parse(values.get(scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY))).openingBalance, { confirmed: true, ascensions: 12, officialDurationMinutes: 345 });
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("favorite_launch_site importe, pagine et pose ses sidecars sans mutation", async () => {
  const context = launchDependencies([row({ id: "a" }), row({ id: "b" }), row({ id: "c", updatedAt: "2026-08-23T12:01:00.000Z" })]);
  const result = await new CloudPullService(context.deps).pullFavoriteLaunchSites(2);
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.applied, 3);
  assert.deepEqual(context.applied.map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(await context.outbox.getMetadata("favorite-launch-site", "c"), {
    entityType: "favorite-launch-site", entityId: "c", revision: 0, updatedAt: "2026-08-23T12:01:00.000Z",
  });
  assert.deepEqual(await context.outbox.list(), []);
  assert.equal((await new CloudPullService(context.deps).pullFavoriteLaunchSites(2)).applied, 0);
});

test("favorite_launch_site protège pending, conflits et révision locale avancée", async () => {
  const preserved = launchDependencies([row({ id: "launch-a", revision: 2 })]);
  await preserved.outbox.setMetadata({ entityType: "favorite-launch-site", entityId: "launch-a", revision: 2, updatedAt: timestamp });
  await preserved.outbox.enqueue({ entityType: "favorite-launch-site", entityId: "launch-a", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(preserved.deps).pullFavoriteLaunchSites()).preservedLocalPending, 1);

  const conflict = launchDependencies([row({ id: "launch-a", revision: 2 })]);
  await conflict.outbox.setMetadata({ entityType: "favorite-launch-site", entityId: "launch-a", revision: 1, updatedAt: timestamp });
  await conflict.outbox.enqueue({ entityType: "favorite-launch-site", entityId: "launch-a", operation: "UPSERT", baseRevision: 1 });
  assert.equal((await new CloudPullService(conflict.deps).pullFavoriteLaunchSites()).conflicts[0].reason, "REMOTE_ADVANCED");

  const anomaly = launchDependencies([row({ id: "launch-a", revision: 1 })]);
  await anomaly.outbox.setMetadata({ entityType: "favorite-launch-site", entityId: "launch-a", revision: 2, updatedAt: timestamp });
  assert.equal((await new CloudPullService(anomaly.deps).pullFavoriteLaunchSites()).state, "BLOCKED_ANOMALY");
});

test("favorite_launch_site traite tombstone, collision locale et USER switch avec le contrat commun", async () => {
  const tombstone = launchDependencies([row({ id: "launch-a", revision: 1, deletedAt: timestamp })]);
  const tombstoneReport = await new CloudPullService(tombstone.deps).pullFavoriteLaunchSites();
  assert.equal(tombstoneReport.tombstonesApplied, 1);
  assert.equal((await tombstone.outbox.getMetadata("favorite-launch-site", "launch-a")).deletedAt, timestamp);

  const collision = launchDependencies([row({ id: "launch-a" })]);
  const historical = { mutationId: "launch-collision", entityType: "favorite-launch-site", entityId: "launch-a", operation: "UPSERT", baseRevision: 0, createdAt: timestamp, attempts: 0 };
  collision.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[historical.mutationId, historical]]) });
  assert.equal((await new CloudPullService(collision.deps).pullFavoriteLaunchSites()).conflicts[0].reason, "LOCAL_CREATION_COLLISION");

  const switched = launchDependencies();
  let checks = 0;
  switched.deps.getScope = () => (++checks >= 4 ? "USER:user-2" : scope);
  assert.equal((await new CloudPullService(switched.deps).pullFavoriteLaunchSites()).state, "STOPPED_USER_SWITCH");
  assert.equal(switched.applied.length, 0);
});

test("l’import silencieux launch site conserve tous les champs puis applique le tombstone sans enqueue", () => {
  const values = new Map(), events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "test@example.test", firstName: "", lastName: "" } });
  const cloud = { id: "launch-a", syncId: "00000000-0000-4000-8000-000000000001", name: "Terrain", sourceName: "Source", latitude: 50, longitude: 3, icaoCode: "LFQQ", altitudeAmslM: 42, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  assert.equal(applyFavoriteLaunchSiteFromCloudWithoutEnqueue(scope, cloud, storage), true);
  const stored = JSON.parse(values.get(scopedBusinessStorageKey(scope, FAVORITE_LAUNCH_SITES_STORAGE_KEY)));
  assert.deepEqual(stored.favorites, [{ id: "launch-a", syncId: cloud.syncId, name: "Terrain", sourceName: "Source", latitude: 50, longitude: 3, icaoCode: "LFQQ", altitudeAmslM: 42, createdAt: timestamp, updatedAt: timestamp }]);
  assert.equal(applyFavoriteLaunchSiteFromCloudWithoutEnqueue(scope, { ...cloud, deletedAt: timestamp }, storage), true);
  assert.deepEqual(JSON.parse(values.get(scopedBusinessStorageKey(scope, FAVORITE_LAUNCH_SITES_STORAGE_KEY))).favorites, []);
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("appareil vierge importe un favori actif, pose le sidecar et ne crée aucune mutation", async () => {
  const context = dependencies();
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.applied, 1);
  assert.equal((await context.outbox.list()).length, 0);
  assert.deepEqual(await context.outbox.getMetadata("favorite-weather-place", "weather-a"), {
    entityType: "favorite-weather-place", entityId: "weather-a", revision: 0, updatedAt: timestamp,
  });
});

test("l’import local silencieux crée, remplace et supprime sans événement d’enqueue", () => {
  const values = new Map();
  const events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "test@example.test", firstName: "", lastName: "" } });
  assert.equal(applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, row(), storage), true);
  assert.equal(applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, row({ name: "Lille updated", revision: 1 }), storage), true);
  assert.equal(applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, row({ deletedAt: timestamp }), storage), true);
  const stored = JSON.parse(values.get(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY)));
  assert.deepEqual(stored.favorites, []);
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("un tombstone absent localement applique seulement le sidecar", async () => {
  const context = dependencies([row({ deletedAt: timestamp, revision: 2 })]);
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.tombstonesApplied, 1);
  assert.equal((await context.outbox.getMetadata("favorite-weather-place", "weather-a")).deletedAt, timestamp);
  assert.equal((await context.outbox.list()).length, 0);
});

test("la pagination lexicographique conserve plusieurs IDs au même timestamp", async () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" }), row({ id: "d", updatedAt: "2026-08-23T12:01:00.000Z" })];
  const context = dependencies(rows);
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces(2);
  assert.equal(result.applied, 4);
  assert.deepEqual(context.applied.map(({ id }) => id), ["a", "b", "c", "d"]);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.cursor, { updatedAt: "2026-08-23T12:01:00.000Z", id: "d" });
});

test("le curseur n’avance pas après un échec et la reprise rejoue la ligne", async () => {
  const context = dependencies([row({ id: "a" }), row({ id: "b" })]);
  context.cursors.failOnId = "b";
  const first = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces(2);
  assert.equal(first.state, "STOPPED_ERROR");
  assert.deepEqual(first.error, { step: "WRITE_CURSOR", code: "UNEXPECTED_ERROR", message: "cursor failed" });
  assert.deepEqual(context.cursors.cursor, { updatedAt: timestamp, id: "a" });
  context.cursors.failOnId = null;
  const second = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces(2);
  assert.equal(second.state, "COMPLETED");
  assert.deepEqual(context.cursors.cursor, { updatedAt: timestamp, id: "b" });
});

test("STOPPED_ERROR expose le diagnostic technique sûr de l'adaptateur", async () => {
  const context = dependencies();
  context.deps.readPage = async () => { throw new CloudPullTechnicalError("PARSE_ROW", "INVALID_FLIGHT_ROW", "Invalid flight cloud summary"); };
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.state, "STOPPED_ERROR");
  assert.deepEqual(result.error, { step: "PARSE_ROW", code: "INVALID_FLIGHT_ROW", message: "Invalid flight cloud summary" });
});

test("un pull répété est idempotent", async () => {
  const context = dependencies();
  assert.equal((await new CloudPullService(context.deps).pullFavoriteWeatherPlaces()).applied, 1);
  assert.equal((await new CloudPullService(context.deps).pullFavoriteWeatherPlaces()).applied, 0);
  assert.equal(context.applied.length, 1);
});

test("GUEST et session absente refusent le pull avant lecture", async () => {
  const guest = dependencies();
  guest.deps.scope = "GUEST";
  guest.setScope("GUEST");
  assert.equal((await new CloudPullService(guest.deps).pullFavoriteWeatherPlaces()).state, "REFUSED_GUEST");
  const session = dependencies();
  session.setOnlineUserId(null);
  assert.equal((await new CloudPullService(session.deps).pullFavoriteWeatherPlaces()).state, "REFUSED_NO_SESSION");
  assert.equal(session.readCalls(), 0);
});

test("un USER switch pendant le pull arrête avant l’application suivante", async () => {
  const context = dependencies();
  let checks = 0;
  context.deps.getScope = () => (++checks >= 4 ? "USER:user-2" : scope);
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.state, "STOPPED_USER_SWITCH");
  assert.equal(context.applied.length, 0);
  assert.equal(context.cursors.cursor, null);
});

test("pending à même révision préserve le local sans conflit", async () => {
  const context = dependencies([row({ revision: 2 })]);
  await context.outbox.setMetadata({ entityType: "favorite-weather-place", entityId: "weather-a", revision: 2, updatedAt: timestamp });
  await context.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "weather-a", operation: "UPSERT", baseRevision: 2 });
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.preservedLocalPending, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(context.applied.length, 0);
  assert.equal((await context.outbox.list()).length, 1);
});

test("remote avancé, tombstone pending et collision de création deviennent des conflits", async () => {
  for (const scenario of [
    { cloud: row({ revision: 2 }), sidecar: 1, base: 1, reason: "REMOTE_ADVANCED" },
    { cloud: row({ revision: 1, deletedAt: timestamp }), sidecar: 1, base: 1, reason: "REMOTE_TOMBSTONE" },
    { cloud: row({ revision: 0 }), sidecar: null, base: 0, reason: "LOCAL_CREATION_COLLISION" },
  ]) {
    const context = dependencies([scenario.cloud]);
    let activeOutbox = context.outbox;
    if (scenario.sidecar !== null) {
      await activeOutbox.setMetadata({ entityType: "favorite-weather-place", entityId: "weather-a", revision: scenario.sidecar, updatedAt: timestamp });
      await activeOutbox.enqueue({ entityType: "favorite-weather-place", entityId: "weather-a", operation: "UPSERT", baseRevision: scenario.base });
    } else {
      const historical = { mutationId: "collision-mutation", entityType: "favorite-weather-place", entityId: "weather-a", operation: "UPSERT", baseRevision: 0, createdAt: timestamp, attempts: 0 };
      activeOutbox = new MemorySyncOutboxStorage({ mutations: new Map([[historical.mutationId, historical]]) });
      context.deps.outbox = activeOutbox;
    }
    const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
    assert.equal(result.conflicts[0].reason, scenario.reason);
    assert.equal(context.applied.length, 0);
    assert.equal((await activeOutbox.list()).length, 1);
  }
});

test("une révision Cloud derrière le sidecar bloque sans avancer", async () => {
  const context = dependencies([row({ revision: 1 })]);
  await context.outbox.setMetadata({ entityType: "favorite-weather-place", entityId: "weather-a", revision: 2, updatedAt: timestamp });
  const result = await new CloudPullService(context.deps).pullFavoriteWeatherPlaces();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "REMOTE_REVISION_BEHIND_LOCAL");
  assert.equal(context.cursors.cursor, null);
  assert.equal(context.applied.length, 0);
});

test("le helper DEV ciblé appelle uniquement le service Pull", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(runtime, /pullFavoriteWeatherPlacesTargeted/);
  assert.match(runtime, /createBrowserFavoriteWeatherPlacePullService/);
  assert.match(runtime, /pullFavoriteWeatherPlacesTargeted: \(\) => pullFavoriteWeatherPlacesTargetedWithVerification\(scope\)/);
  const helper = runtime.match(/async function pullFavoriteWeatherPlacesTargetedWithVerification[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /enqueueEvents/);
  assert.match(helper, /outboxBefore/);
  assert.match(helper, /outboxAfter/);
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});

test("l’inspection du test Pull reste strictement read-only", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(runtime, /inspectFavoriteWeatherPullTestState/);
  assert.match(runtime, /bc-pull-targeted-test-20260823-v1/);
  const helper = runtime.match(/async function inspectFavoriteWeatherPullTestState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /outbox\.list\(\)/);
  assert.match(helper, /outbox\.getMetadata/);
  assert.match(helper, /BrowserCloudPullCursorRepository/);
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
});

test("les helpers launch site ciblés utilisent uniquement le PULL et l'inspection locale", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  assert.match(browser, /from\("favorite_launch_sites"\)[\s\S]*?source_name[\s\S]*?altitude_amsl_m/);
  assert.match(runtime, /pullFavoriteLaunchSitesTargeted: \(\) => pullFavoriteLaunchSitesTargetedWithVerification\(scope\)/);
  assert.match(runtime, /inspectFavoriteLaunchSitePullState: \(\) => inspectFavoriteLaunchSitePullState\(scope\)/);
  const pull = runtime.match(/async function pullFavoriteLaunchSitesTargetedWithVerification[\s\S]*?\n\}/)?.[0] ?? "";
  const inspection = runtime.match(/async function inspectFavoriteLaunchSitePullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(pull, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
});

test("les helpers profile ciblés restent PULL-only et READ-ONLY", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  assert.match(browser, /from\("profiles"\)[\s\S]*?first_name[\s\S]*?opening_official_duration_minutes/);
  assert.match(runtime, /pullPilotProfileTargeted: \(\) => pullPilotProfileTargetedWithVerification\(scope\)/);
  assert.match(runtime, /inspectPilotProfilePullState: \(\) => inspectPilotProfilePullState\(scope\)/);
  const pull = runtime.match(/async function pullPilotProfileTargetedWithVerification[\s\S]*?\n\}/)?.[0] ?? "";
  const inspection = runtime.match(/async function inspectPilotProfilePullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(pull, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
});
