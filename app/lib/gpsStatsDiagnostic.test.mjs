import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight } from "./recordedFlight.ts";
import { classifyGpsTraceQuality } from "./gpsPointQuality.ts";
import { diagnoseRecordedFlight, loadGpsStatisticsDiagnostic } from "./gpsStatsDiagnostic.ts";
import { recalculateFlightStatistics } from "./recordedFlight.ts";

const points = [0, 1, 2, 3, 4, 5].map((second) => ({
  timestamp: second * 1_000,
  latitude: 50,
  longitude: 3 + second * 0.00001,
  altitudeMeters: 100 + second * 4.5,
  speedMetersPerSecond: 8 + second,
  headingDegrees: 90,
  horizontalAccuracyMeters: 5,
  verticalAccuracyMeters: 8,
}));

function flight() {
  return { ...createRecordedFlight({ id: "real", startedAt: 0 }), endedAt: 5_000, status: "COMPLETED", points };
}

test("le diagnostic est strictement en lecture seule", async () => {
  const source = flight();
  const before = structuredClone(source);
  const writes = [];
  const storage = {
    listFlights: async () => [source],
    getActiveFlight: async () => null,
    getFlight: async () => source,
    saveActiveFlight: async () => writes.push("save"),
    clearActiveFlight: async () => writes.push("clear"),
    completeFlight: async () => writes.push("complete"),
    deleteFlight: async () => writes.push("delete"),
  };
  const result = await loadGpsStatisticsDiagnostic(storage);
  assert.equal(result?.flightId, "real");
  assert.deepEqual(writes, []);
  assert.deepEqual(source, before);
});

test("les nouvelles statistiques sont exactement celles du moteur GPS Quality #3", () => {
  const source = flight();
  const diagnostic = diagnoseRecordedFlight(source);
  assert.deepEqual(
    diagnostic.newStatistics,
    recalculateFlightStatistics(classifyGpsTraceQuality(source.points), source.startedAt, source.endedAt),
  );
});

test("un ancien vol sans quality est recalculé sans mutation", () => {
  const source = flight();
  const before = structuredClone(source.points);
  const diagnostic = diagnoseRecordedFlight(source);
  assert.equal(diagnostic.pointCounts.total, points.length);
  assert.deepEqual(source.points, before);
});

test("les records exposent timestamp, fenêtre et points contributeurs", () => {
  const records = diagnoseRecordedFlight(flight()).records;
  assert.equal(records.maximumSpeed.timestamp, 5_000);
  assert.equal(records.maximumSpeed.points.length, 1);
  assert.ok((records.maximumClimb.windowMilliseconds ?? 0) >= 3_000);
  assert.ok(records.maximumClimb.points.length >= 3);
  assert.equal(records.maximumClimb.timestamp, 3_000);
});
