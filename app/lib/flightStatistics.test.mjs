import assert from "node:assert/strict";
import test from "node:test";
import { recalculateFlightStatistics } from "./recordedFlight.ts";

function point({
  timestamp,
  altitudeMeters = 100,
  latitude = 50,
  longitude = 3,
  speedMetersPerSecond = 5,
  quality = "VALID",
  qualityReason = "NONE",
  ...metadata
}) {
  return {
    timestamp, altitudeMeters, latitude, longitude, speedMetersPerSecond,
    headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8,
    quality, qualityReason, ...metadata,
  };
}

test("un faux pic vertical isolé est absent du record", () => {
  const points = [
    point({ timestamp: 0, altitudeMeters: 100 }),
    point({ timestamp: 1_000, altitudeMeters: 120, quality: "SUSPECT", qualityReason: "ALTITUDE_SPIKE" }),
    point({ timestamp: 2_000, altitudeMeters: 101 }),
    point({ timestamp: 4_000, altitudeMeters: 102 }),
  ];
  assert.ok((recalculateFlightStatistics(points).maximumClimbRateMetersPerSecond ?? 0) < 20);
});

test("une montée soutenue de +4.5 m/s est conservée", () => {
  const points = [0, 1, 2, 3, 4, 5].map((second) =>
    point({ timestamp: second * 1_000, altitudeMeters: 100 + second * 4.5 }),
  );
  assert.equal(recalculateFlightStatistics(points).maximumClimbRateMetersPerSecond, 4.5);
});

test("une descente soutenue de -15 m/s est conservée", () => {
  const points = [0, 1, 2, 3, 4, 5].map((second) =>
    point({ timestamp: second * 1_000, altitudeMeters: 500 - second * 15 }),
  );
  assert.equal(recalculateFlightStatistics(points).maximumDescentRateMetersPerSecond, -15);
});

test("une vitesse élevée soutenue vingt secondes est conservée", () => {
  const points = [0, 5, 10, 15, 20].map((second, index) =>
    point({ timestamp: second * 1_000, longitude: 3 + index * 0.001, speedMetersPerSecond: 35 }),
  );
  assert.equal(recalculateFlightStatistics(points).maxGroundSpeedMetersPerSecond, 35);
});

test("un gap background ne crée ni distance ni record artificiel", () => {
  const points = [
    point({ timestamp: 0, altitudeMeters: 100 }),
    point({ timestamp: 1_000, altitudeMeters: 101, longitude: 3.00001 }),
    point({ timestamp: 31_000, altitudeMeters: 500, longitude: 4, quality: "SUSPECT", qualityReason: "BACKGROUND_RESUME", appState: "RESUME" }),
    point({ timestamp: 32_000, altitudeMeters: 501, longitude: 4.00001 }),
    point({ timestamp: 36_000, altitudeMeters: 505, longitude: 4.00005 }),
  ];
  const statistics = recalculateFlightStatistics(points);
  assert.ok(statistics.distanceMeters < 100);
  assert.ok((statistics.maximumClimbRateMetersPerSecond ?? 0) < 5);
});

test("un saut GPS INVALID n'affecte ni distance ni vitesse max", () => {
  const points = [
    point({ timestamp: 0, longitude: 3, speedMetersPerSecond: 5 }),
    point({ timestamp: 1_000, longitude: 4, speedMetersPerSecond: 100, quality: "INVALID", qualityReason: "POSITION_JUMP" }),
    point({ timestamp: 2_000, longitude: 3.00001, speedMetersPerSecond: 5 }),
    point({ timestamp: 5_000, longitude: 3.00004, speedMetersPerSecond: 5 }),
  ];
  const statistics = recalculateFlightStatistics(points);
  assert.equal(statistics.maxGroundSpeedMetersPerSecond, 5);
  assert.ok(statistics.distanceMeters < 100);
});

test("compatibilité : un ancien vol sans quality traite tous ses points comme VALID", () => {
  const legacy = [
    point({ timestamp: 0, longitude: 3 }),
    point({ timestamp: 4_000, longitude: 3.001 }),
  ].map(({ quality: _quality, qualityReason: _reason, ...raw }) => raw);
  const statistics = recalculateFlightStatistics(legacy);
  assert.ok(statistics.distanceMeters > 70);
  assert.equal(statistics.maxGroundSpeedMetersPerSecond, 5);
});
