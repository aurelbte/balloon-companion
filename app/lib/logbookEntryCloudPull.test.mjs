import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { CloudPullService } from "./cloudPullService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { applyOfficialAscensionFromCloudWithoutEnqueue, FLIGHT_COMPLETION_STORAGE_KEY, hasOfficialAscensionSourceFlightConflict } from "./flightCompletionStorage.ts";

const scope = "USER:user-1";
const now = "2026-08-24T08:00:00.000Z";
const instructor = { firstName: "Instructeur", lastName: "Test", licenceNumber: "FI-1" };
const examiner = { firstName: "Examinateur", lastName: "Test", licenceNumber: "FE-1" };
const ascension = (overrides = {}) => ({ id: "entry-a", sourceFlightId: "flight-a", source: "GPS_BALLOON_COMPANION", dateIso: "2026-08-24", date: "24 août 2026", balloonModel: "Z105", balloonManufacturer: "Cameron", registration: "F-CLOUD", departure: "Départ", arrival: "Arrivée", category: "Libre à air chaud", pilotFunction: "Pilote", nightFlight: false, maximumAltitudeM: 1000, gpsDurationMinutes: 42, officialDurationMinutes: 40, observations: "Cloud official", flightNature: "TRAINING_BPL", takeoffCount: 2, landingCount: 2, instructor, examiner, ...overrides });
const row = (overrides = {}) => ({ id: "entry-a", entityId: "entry-a", userId: "user-1", revision: 0, createdAt: now, updatedAt: now, deletedAt: null, value: ascension(), ...overrides });

class Cursors {
  values = new Map();
  async get(_scope, domain) { return this.values.get(domain) ?? null; }
  async set(_scope, domain, cursor) { this.values.set(domain, cursor); }
}

function context(rows = [row()], uniquenessConflict = false) {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => crypto.randomUUID(), now: () => now } });
  const cursors = new Cursors(), applied = [], conflicts = [];
  let currentScope = scope, user = "user-1", checks = 0, switchAt = Infinity;
  const deps = {
    scope,
    getScope: () => (++checks >= switchAt ? "USER:user-2" : currentScope),
    getOnlineUserId: async () => user,
    outbox,
    cursors,
    readPage: async () => [],
    applyLocally: () => false,
    logbookEntryDomain: {
      readPage: async (cursor, limit) => rows.filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit),
      localAnomaly: (cloud) => !cloud.deletedAt && uniquenessConflict ? "LOCAL_UNIQUENESS_CONFLICT" : null,
      applyLocally: async (cloud) => { applied.push(cloud); return true; },
    },
    recordConflict: async (conflict) => conflicts.push(conflict),
  };
  return { deps, outbox, cursors, applied, setScope: (value) => { currentScope = value; }, setUser: (value) => { user = value; }, switchAt: (value) => { switchAt = value; } };
}

function browserStorage() {
  const values = new Map(), events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "pull@example.test", firstName: "", lastName: "" } });
  const key = scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY);
  values.set(key, JSON.stringify({ version: 4, openingBalance: { confirmed: true, ascensions: 10, officialDurationMinutes: 600 }, journalFlights: [], officialAscensions: [] }));
  return { values, events, storage, key };
}

test("appareil vierge importe logbook_entry, pose le sidecar et ne crée aucune mutation", async () => {
  const ctx = context();
  await ctx.outbox.enqueue({ entityType: "flight", entityId: "unrelated", operation: "UPSERT" });
  const service = new CloudPullService(ctx.deps);
  assert.equal((await service.pullLogbookEntries()).applied, 1);
  assert.equal((await service.pullLogbookEntries()).applied, 0);
  assert.equal(ctx.applied.length, 1);
  assert.deepEqual(await ctx.outbox.getMetadata("logbook-entry", "entry-a"), { entityType: "logbook-entry", entityId: "entry-a", revision: 0, updatedAt: now });
  assert.deepEqual((await ctx.outbox.list()).map(({ entityType }) => entityType), ["flight"]);
});

test("import silencieux conserve exactement les champs réglementaires et UPDATE le même id", () => {
  const env = browserStorage();
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-a", ascension(), env.storage), true);
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-a", ascension({ observations: "UPDATED", officialDurationMinutes: 41 }), env.storage), true);
  const state = JSON.parse(env.values.get(env.key));
  assert.equal(state.officialAscensions.length, 1);
  assert.deepEqual(state.officialAscensions[0], ascension({ observations: "UPDATED", officialDurationMinutes: 41 }));
  assert.deepEqual(state.officialAscensions[0].instructor, instructor);
  assert.deepEqual(state.officialAscensions[0].examiner, examiner);
  assert.equal(state.officialAscensions[0].takeoffCount, 2);
  assert.equal(state.officialAscensions[0].landingCount, 2);
  assert.equal(env.events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("le PULL conserve une ascension CAPTIVE sans GPS", () => {
  const env = browserStorage();
  const captive = ascension({ id: "entry-captive", sourceFlightId: null, source: "MANUAL", gpsDurationMinutes: null, flightNature: "CAPTIVE", instructor: undefined, examiner: undefined });
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, captive.id, captive, env.storage), true);
  const restored = JSON.parse(env.values.get(env.key)).officialAscensions[0];
  assert.equal(restored.flightNature, "CAPTIVE");
  assert.equal(restored.sourceFlightId, null);
  assert.equal(restored.gpsDurationMinutes, null);
  delete globalThis.window;
});

test("flight parent absent est conservé comme référence différée sans flight fantôme", () => {
  const env = browserStorage();
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-a", ascension({ sourceFlightId: "missing-flight" }), env.storage), true);
  const state = JSON.parse(env.values.get(env.key));
  assert.equal(state.officialAscensions[0].sourceFlightId, "missing-flight");
  assert.equal(state.journalFlights.length, 0);
  delete globalThis.window;
});

test("même sourceFlightId avec autre id bloque explicitement sans remplacement", async () => {
  const env = browserStorage();
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-existing", ascension({ id: "entry-existing" }), env.storage), true);
  assert.equal(hasOfficialAscensionSourceFlightConflict("entry-a", "flight-a"), true);
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-a", ascension(), env.storage), false);
  assert.deepEqual(JSON.parse(env.values.get(env.key)).officialAscensions.map(({ id }) => id), ["entry-existing"]);
  delete globalThis.window;
  const ctx = context([row()], true);
  const result = await new CloudPullService(ctx.deps).pullLogbookEntries();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "LOCAL_UNIQUENESS_CONFLICT");
  assert.equal(ctx.applied.length, 0);
  assert.equal(ctx.cursors.values.has("logbook-entry"), false);
});

test("tombstone supprime uniquement l'ascension ciblée et conserve Journal et autres ascensions", () => {
  const env = browserStorage();
  const state = { version: 4, openingBalance: { confirmed: true, ascensions: 10, officialDurationMinutes: 600 }, journalFlights: [{ id: "flight-a" }], officialAscensions: [ascension(), ascension({ id: "entry-b", sourceFlightId: "flight-b" })] };
  env.values.set(env.key, JSON.stringify(state));
  assert.equal(applyOfficialAscensionFromCloudWithoutEnqueue(scope, "entry-a", null, env.storage), true);
  const next = JSON.parse(env.values.get(env.key));
  assert.deepEqual(next.officialAscensions.map(({ id }) => id), ["entry-b"]);
  assert.deepEqual(next.journalFlights, state.journalFlights);
  delete globalThis.window;
});

test("tombstone Cloud pose le sidecar sans cascade", async () => {
  const ctx = context([row({ revision: 2, deletedAt: now })]);
  const result = await new CloudPullService(ctx.deps).pullLogbookEntries();
  assert.equal(result.tombstonesApplied, 1);
  assert.equal((await ctx.outbox.getMetadata("logbook-entry", "entry-a")).deletedAt, now);
  assert.equal((await ctx.outbox.list()).length, 0);
});

test("pending égal est préservé; distant avancé, tombstone pending et collision sont des conflits", async () => {
  const equal = context([row({ revision: 2 })]);
  await equal.outbox.setMetadata({ entityType: "logbook-entry", entityId: "entry-a", revision: 2, updatedAt: now });
  await equal.outbox.enqueue({ entityType: "logbook-entry", entityId: "entry-a", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(equal.deps).pullLogbookEntries()).preservedLocalPending, 1);
  for (const scenario of [
    { cloud: row({ revision: 2 }), sidecar: 1, reason: "REMOTE_ADVANCED" },
    { cloud: row({ revision: 1, deletedAt: now }), sidecar: 1, reason: "REMOTE_TOMBSTONE" },
    { cloud: row(), sidecar: null, reason: "LOCAL_CREATION_COLLISION" },
  ]) {
    const ctx = context([scenario.cloud]);
    if (scenario.sidecar !== null) {
      await ctx.outbox.setMetadata({ entityType: "logbook-entry", entityId: "entry-a", revision: scenario.sidecar, updatedAt: now });
      await ctx.outbox.enqueue({ entityType: "logbook-entry", entityId: "entry-a", operation: "UPSERT", baseRevision: scenario.sidecar });
    } else {
      const mutation = { mutationId: "collision", entityType: "logbook-entry", entityId: "entry-a", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 };
      ctx.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[mutation.mutationId, mutation]]) });
    }
    assert.equal((await new CloudPullService(ctx.deps).pullLogbookEntries()).conflicts[0].reason, scenario.reason);
    assert.equal(ctx.applied.length, 0);
  }
});

test("révision distante derrière sidecar bloque sans rebase", async () => {
  const ctx = context([row({ revision: 1 })]);
  await ctx.outbox.setMetadata({ entityType: "logbook-entry", entityId: "entry-a", revision: 2, updatedAt: now });
  const result = await new CloudPullService(ctx.deps).pullLogbookEntries();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "REMOTE_REVISION_BEHIND_LOCAL");
});

test("pagination, timestamp identique, GUEST, session absente et USER switch sont sûrs", async () => {
  const paged = context(["a", "b", "c"].map((id) => row({ id, entityId: id })));
  assert.deepEqual((await new CloudPullService(paged.deps).pullLogbookEntries(2)).cursor, { updatedAt: now, id: "c" });
  const guest = context(); guest.deps.scope = "GUEST"; guest.setScope("GUEST");
  assert.equal((await new CloudPullService(guest.deps).pullLogbookEntries()).state, "REFUSED_GUEST");
  const expired = context(); expired.setUser(null);
  assert.equal((await new CloudPullService(expired.deps).pullLogbookEntries()).state, "REFUSED_NO_SESSION");
  const switched = context(); switched.switchAt(4);
  assert.equal((await new CloudPullService(switched.deps).pullLogbookEntries()).state, "STOPPED_USER_SWITCH");
  assert.equal(switched.applied.length, 0);
});

test("adaptateur et helpers restent sans flight fantôme, GPS, enqueue, RPC ni auto-pull", () => {
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  const completion = readFileSync(new URL("./flightCompletionStorage.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(browser, /from\("logbook_entries"\)[\s\S]*?\.select\("id,user_id,revision,created_at,updated_at,deleted_at,flight_id,source,date_iso,balloon_model,balloon_manufacturer,registration,departure,arrival,category,pilot_function,night_flight,maximum_altitude_m,gps_duration_minutes,official_duration_minutes,observations,flight_nature,takeoff_count,landing_count,instructor,examiner"\)/);
  const adapter = browser.match(/export function createBrowserLogbookEntryPullService[\s\S]*$/)?.[0] ?? "";
  assert.doesNotMatch(adapter, /createRecordedFlight|completeFlight|saveFlightCompletionState|syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(/);
  const silent = completion.match(/export function applyOfficialAscensionFromCloudWithoutEnqueue[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(silent, /enqueueLocalSyncMutation|persistOfficialAscension|saveFlightCompletionState|points/);
  for (const helper of ["pullLogbookEntriesTargeted", "inspectLogbookEntryPullState"]) assert.match(runtime, new RegExp(helper));
  const inspection = runtime.match(/async function inspectLogbookEntryPullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
  assert.doesNotMatch(runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "", /pullLogbookEntries/);
});
