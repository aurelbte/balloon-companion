import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { CloudPullService } from "./cloudPullService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { mergeRecordedFlightFromCloud } from "./recordedFlightStorage.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";
import { applyRecordedFlightToJournalFromCloudWithoutEnqueue, FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";

const scope = "USER:user-1";
const now = "2026-08-23T16:00:00.000Z";
const summary = { durationSeconds: 2400, distanceMeters: 12345, minAltitudeMeters: 100, maxAltitudeMeters: 900, averageGroundSpeedMetersPerSecond: 5, maxGroundSpeedMetersPerSecond: 8, maximumClimbRateMetersPerSecond: 2, maximumDescentRateMetersPerSecond: -1 };
const flight = (overrides = {}) => ({ id: "flight-a", schemaVersion: 1, status: "COMPLETED", startedAt: Date.parse(now), endedAt: Date.parse(now) + 2400000, points: [], summary, createdAt: Date.parse(now), updatedAt: Date.parse(now), balloonRegistration: "F-CLOUD", startLocationLabel: "Cloud départ", endLocationLabel: "Cloud arrivée", generatedTitle: "Cloud flight", notes: "metadata only", ...overrides });
const row = (overrides = {}) => ({ id: "flight-a", entityId: "flight-a", userId: "user-1", revision: 0, createdAt: now, updatedAt: now, deletedAt: null, value: { flight: flight(), journal: { customTitle: null, origin: "REAL_GPS", logbookStatus: "CARNET_PENDING", recovered: false }, balloonId: null }, ...overrides });

class Cursors {
  values = new Map();
  async get(_scope, domain) { return this.values.get(domain) ?? null; }
  async set(_scope, domain, cursor) { this.values.set(domain, cursor); }
}

function context(rows = [row()]) {
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
    flightDomain: {
      readPage: async (cursor, limit) => rows.filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit),
      applyLocally: async (cloud) => { applied.push(cloud); return true; },
    },
    recordConflict: async (conflict) => conflicts.push(conflict),
  };
  return { deps, outbox, cursors, applied, conflicts, setScope: (value) => { currentScope = value; }, setUser: (value) => { user = value; }, switchAt: (value) => { switchAt = value; } };
}

test("un flight Cloud actif est importé avec sidecar exact sans mutation", async () => {
  const ctx = context();
  await ctx.outbox.enqueue({ entityType: "balloon", entityId: "unrelated", operation: "UPSERT" });
  const service = new CloudPullService(ctx.deps);
  assert.equal((await service.pullFlights()).applied, 1);
  assert.equal((await service.pullFlights()).applied, 0);
  assert.equal(ctx.applied.length, 1);
  assert.deepEqual(await ctx.outbox.getMetadata("flight", "flight-a"), { entityType: "flight", entityId: "flight-a", revision: 0, updatedAt: now });
  assert.deepEqual((await ctx.outbox.list()).map(({ entityType }) => entityType), ["balloon"]);
});

test("metadata-only conserve le résumé Cloud sans inventer de point et une UPDATE préserve une trace locale", () => {
  const cloud = flight();
  const journal = recordedFlightToJournalFlight(cloud);
  assert.equal(cloud.points.length, 0);
  assert.equal(journal.points.length, 0);
  assert.equal(journal.durationMinutes, 40);
  assert.equal(journal.distanceKm, 12.345);
  assert.equal(journal.maxAltitudeM, 900);
  const localPoint = { timestamp: cloud.startedAt, latitude: 1, longitude: 2, altitudeMeters: 3, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null };
  assert.deepEqual(mergeRecordedFlightFromCloud(flight({ points: [localPoint] }), flight({ notes: "updated" })).points, [localPoint]);
  assert.deepEqual(mergeRecordedFlightFromCloud(null, cloud).points, []);
});

test("projection Journal silencieuse insère, met à jour et tombstone sans toucher l'ascension officielle", () => {
  const values = new Map(), events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "pull@example.test", firstName: "", lastName: "" } });
  const key = scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY);
  const ascension = { id: "official-a", sourceFlightId: "flight-a", source: "GPS_BALLOON_COMPANION" };
  values.set(key, JSON.stringify({ version: 4, openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null }, journalFlights: [], officialAscensions: [ascension] }));
  const metadata = { customTitle: "Cloud title", origin: "REAL_GPS", logbookStatus: "CARNET_VALIDATED", recovered: false };
  assert.equal(applyRecordedFlightToJournalFromCloudWithoutEnqueue(scope, "flight-a", flight(), metadata, storage), true);
  assert.equal(applyRecordedFlightToJournalFromCloudWithoutEnqueue(scope, "flight-a", flight({ notes: "updated" }), metadata, storage), true);
  let state = JSON.parse(values.get(key));
  assert.equal(state.journalFlights.length, 1);
  assert.equal(state.journalFlights[0].points.length, 0);
  assert.equal(state.officialAscensions.length, 1);
  assert.equal(applyRecordedFlightToJournalFromCloudWithoutEnqueue(scope, "flight-a", null, null, storage), true);
  state = JSON.parse(values.get(key));
  assert.equal(state.journalFlights.length, 0);
  assert.deepEqual(state.officialAscensions, [ascension]);
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("tombstone supprime uniquement flight et pose le sidecar", async () => {
  const ctx = context([row({ revision: 2, deletedAt: now })]);
  const result = await new CloudPullService(ctx.deps).pullFlights();
  assert.equal(result.tombstonesApplied, 1);
  assert.equal((await ctx.outbox.getMetadata("flight", "flight-a")).deletedAt, now);
  assert.equal((await ctx.outbox.list()).length, 0);
});

test("pending égal est préservé; distant avancé, tombstone pending et collision sont des conflits", async () => {
  const equal = context([row({ revision: 2 })]);
  await equal.outbox.setMetadata({ entityType: "flight", entityId: "flight-a", revision: 2, updatedAt: now });
  await equal.outbox.enqueue({ entityType: "flight", entityId: "flight-a", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(equal.deps).pullFlights()).preservedLocalPending, 1);
  for (const scenario of [
    { cloud: row({ revision: 2 }), sidecar: 1, reason: "REMOTE_ADVANCED" },
    { cloud: row({ revision: 1, deletedAt: now }), sidecar: 1, reason: "REMOTE_TOMBSTONE" },
    { cloud: row(), sidecar: null, reason: "LOCAL_CREATION_COLLISION" },
  ]) {
    const ctx = context([scenario.cloud]);
    if (scenario.sidecar !== null) {
      await ctx.outbox.setMetadata({ entityType: "flight", entityId: "flight-a", revision: scenario.sidecar, updatedAt: now });
      await ctx.outbox.enqueue({ entityType: "flight", entityId: "flight-a", operation: "UPSERT", baseRevision: scenario.sidecar });
    } else {
      const mutation = { mutationId: "collision", entityType: "flight", entityId: "flight-a", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 };
      ctx.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[mutation.mutationId, mutation]]) });
    }
    assert.equal((await new CloudPullService(ctx.deps).pullFlights()).conflicts[0].reason, scenario.reason);
    assert.equal(ctx.applied.length, 0);
  }
});

test("révision distante derrière sidecar bloque sans rebase", async () => {
  const ctx = context([row({ revision: 1 })]);
  await ctx.outbox.setMetadata({ entityType: "flight", entityId: "flight-a", revision: 2, updatedAt: now });
  const result = await new CloudPullService(ctx.deps).pullFlights();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "REMOTE_REVISION_BEHIND_LOCAL");
});

test("pagination à timestamp identique, GUEST, session absente et USER switch sont sûrs", async () => {
  const paged = context(["a", "b", "c"].map((id) => row({ id, entityId: id })));
  assert.deepEqual((await new CloudPullService(paged.deps).pullFlights(2)).cursor, { updatedAt: now, id: "c" });
  const guest = context(); guest.deps.scope = "GUEST"; guest.setScope("GUEST");
  assert.equal((await new CloudPullService(guest.deps).pullFlights()).state, "REFUSED_GUEST");
  const expired = context(); expired.setUser(null);
  assert.equal((await new CloudPullService(expired.deps).pullFlights()).state, "REFUSED_NO_SESSION");
  const switched = context(); switched.switchAt(4);
  assert.equal((await new CloudPullService(switched.deps).pullFlights()).state, "STOPPED_USER_SWITCH");
  assert.equal(switched.applied.length, 0);
});

test("adaptateur accepte balloon présent ou absent sans fantôme, sans GPS, cascade, enqueue ni auto-pull", () => {
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("./recordedFlightStorage.ts", import.meta.url), "utf8");
  const completion = readFileSync(new URL("./flightCompletionStorage.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(browser, /from\("flights"\)[\s\S]*?\.select\("id,user_id,revision,created_at,updated_at,deleted_at,schema_version,status,started_at,ended_at,balloon_id,balloon_registration,start_location_label,end_location_label,generated_title,custom_title,notes,origin,logbook_status,recovered,summary,weather_model,weather_snapshot,ground_calibration"\)/);
  const adapter = browser.match(/export function createBrowserFlightPullService[\s\S]*$/)?.[0] ?? "";
  assert.doesNotMatch(adapter, /addBalloon|createBalloon|deleteByBalloonId|syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(/);
  assert.match(storage, /applyFromCloudWithoutEnqueue/);
  assert.doesNotMatch(storage.match(/applyFromCloudWithoutEnqueue[\s\S]*?\n  \}/)?.[0] ?? "", /enqueueLocalSyncMutation/);
  assert.doesNotMatch(completion.match(/applyRecordedFlightToJournalFromCloudWithoutEnqueue[\s\S]*?\n\}/)?.[0] ?? "", /saveFlightCompletionState|enqueueLocalSyncMutation|persistOfficialAscension/);
  for (const helper of ["pullFlightsTargeted", "inspectFlightPullState"]) assert.match(runtime, new RegExp(helper));
  const inspection = runtime.match(/async function inspectFlightPullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
  assert.doesNotMatch(runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "", /pullFlights/);
});
