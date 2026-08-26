import assert from "node:assert/strict";
import test from "node:test";

import {
  HAZEBROUCK_BACKUP_FLIGHT_ID,
  restoreRecordedFlightBackupTargeted,
} from "./recordedFlightBackupRestore.ts";

function backup(overrides = {}) {
  const startedAt = Date.parse("2026-08-16T05:27:00.000Z");
  return {
    id: HAZEBROUCK_BACKUP_FLIGHT_ID,
    sourceFlightId: HAZEBROUCK_BACKUP_FLIGHT_ID,
    startedAt,
    departure: "Boeschepe",
    arrival: "Hazebrouck",
    date: "16 août 2026",
    dateIso: "2026-08-16",
    balloonRegistration: "F-TEST",
    durationMinutes: 301,
    distanceKm: 13.3,
    takeoffTime: "07:27",
    landingTime: "12:28",
    maxAltitudeM: 811,
    maxSpeedKmh: 32,
    notes: null,
    statistics: {
      takeoffAltitudeAmslM: 20,
      landingAltitudeAmslM: 25,
      averageAltitudeAmslM: 420,
      averageSpeedKmh: 12,
      minimumInFlightSpeedKmh: 0,
      maximumClimbRateMps: 2,
      maximumDescentRateMps: -2,
      averageHeadingDeg: 90,
      directDistanceKm: 10,
    },
    points: Array.from({ length: 3323 }, (_, index) => ({
      longitude: 2.69 + index / 1_000_000,
      latitude: 50.8 + index / 1_000_000,
      elapsedMinutes: index / 11,
      altitudeM: 20 + index / 10,
      speedKmh: 12,
    })),
    logbookStatus: "CARNET_VALIDATED",
    origin: "REAL_GPS",
    ...overrides,
  };
}

function harness(input = {}) {
  let recorded = input.recorded ?? null;
  let journals = input.journals ?? [];
  let enqueueCount = 0;
  let logbookEntryCount = 0;
  const dependencies = {
    scope: input.scope === undefined ? "USER:user-1" : input.scope,
    getCurrentScope: () => input.currentScope === undefined ? "USER:user-1" : input.currentScope,
    getRecordedFlight: async () => recorded,
    getJournalFlights: () => journals,
    persistRecordedFlight: async (flight) => { recorded = structuredClone(flight); },
    persistJournalFlight: (flight) => { journals = [...journals, { ...structuredClone(flight), points: [] }]; return true; },
    enqueueFlightUpsert: async () => { enqueueCount += 1; return true; },
  };
  return {
    dependencies,
    state: () => ({ recorded, journals, enqueueCount, logbookEntryCount }),
    setRecorded: (value) => { recorded = value; },
    setJournals: (value) => { journals = value; },
  };
}

test("restaure RecordedFlight et Journal sans perdre les 3323 échantillons", async () => {
  const context = harness();
  const result = await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  assert.equal(result.state, "RESTORED");
  assert.equal(result.recordedFlightRestored, true);
  assert.equal(result.journalFlightRestored, true);
  assert.equal(context.state().recorded.points.length, 3323);
  assert.equal(context.state().recorded.points[3322].latitude, backup().points[3322].latitude);
  assert.equal(context.state().journals[0].points.length, 0);
  assert.equal(context.state().enqueueCount, 1);
  assert.equal(context.state().logbookEntryCount, 0);
});

test("un second import exact est ALREADY_PRESENT sans mutation", async () => {
  const context = harness();
  await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  const result = await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  assert.equal(result.state, "ALREADY_PRESENT");
  assert.equal(context.state().enqueueCount, 1);
});

test("une collision RecordedFlight différente bloque toute écriture", async () => {
  const context = harness();
  await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  const changed = structuredClone(context.state().recorded);
  changed.points[0].latitude += 0.1;
  context.setRecorded(changed);
  context.setJournals([]);
  const result = await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  assert.equal(result.state, "CONFLICT");
  assert.equal(result.reason, "RECORDED_FLIGHT_CONTENT_DIFFERS");
  assert.equal(context.state().journals.length, 0);
});

test("complète uniquement RecordedFlight lorsque le Journal cohérent existe", async () => {
  const seed = harness();
  await restoreRecordedFlightBackupTargeted(backup(), seed.dependencies);
  const context = harness({ journals: seed.state().journals });
  const result = await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  assert.equal(result.reason, "RECORDED_COMPLETED");
  assert.equal(result.recordedFlightRestored, true);
  assert.equal(result.journalFlightRestored, false);
});

test("complète uniquement le Journal lorsque RecordedFlight cohérent existe", async () => {
  const seed = harness();
  await restoreRecordedFlightBackupTargeted(backup(), seed.dependencies);
  const context = harness({ recorded: seed.state().recorded });
  const result = await restoreRecordedFlightBackupTargeted(backup(), context.dependencies);
  assert.equal(result.reason, "JOURNAL_COMPLETED");
  assert.equal(result.recordedFlightRestored, false);
  assert.equal(result.journalFlightRestored, true);
});

test("refuse absence USER, GUEST, ids incohérents et points invalides", async () => {
  assert.equal((await restoreRecordedFlightBackupTargeted(backup(), harness({ scope: null }).dependencies)).reason, "USER_SCOPE_REQUIRED");
  assert.equal((await restoreRecordedFlightBackupTargeted(backup(), harness({ scope: "GUEST", currentScope: "GUEST" }).dependencies)).reason, "USER_SCOPE_REQUIRED");
  assert.equal((await restoreRecordedFlightBackupTargeted(backup({ sourceFlightId: "other" }), harness().dependencies)).reason, "ID_SOURCE_FLIGHT_ID_MISMATCH");
  assert.equal((await restoreRecordedFlightBackupTargeted(backup({ points: [{ latitude: 100, longitude: 2, elapsedMinutes: 0, altitudeM: 1, speedKmh: 1 }] }), harness().dependencies)).reason, "INVALID_POINTS");
});

test("le wiring DEV reste ciblé et n'appelle ni RPC ni logbook-entry", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(source, /restoreRecordedFlightBackupTargeted/);
  assert.match(source, /inspectRecordedFlightBackupRestoreState/);
  assert.doesNotMatch(source.match(/restoreRecordedFlightBackupTargeted: \(backup:[\s\S]*?\n      \},/)?.[0] ?? "", /syncMutationById|logbook-entry|supabase/);
});
