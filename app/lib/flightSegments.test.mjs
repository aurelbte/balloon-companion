import assert from "node:assert/strict";
import test from "node:test";
import { buildFlightSegments } from "./flightSegments.ts";
import { calculateFlightGapDistanceLinks, recalculateFlightStatistics } from "./recordedFlight.ts";

function point({ timestamp, longitude = 3, quality = "VALID", qualityReason = "NONE", ...metadata }) {
  return {
    timestamp, latitude: 50, longitude, altitudeMeters: 100,
    speedMetersPerSecond: 5, headingDegrees: 90,
    horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8,
    quality, qualityReason, ...metadata,
  };
}

test("un vol continu forme un seul segment sans muter la trace", () => {
  const source = [point({ timestamp: 0 }), point({ timestamp: 1_000 })];
  const before = structuredClone(source);
  const segments = buildFlightSegments(source);
  assert.equal(segments.length, 1);
  assert.deepEqual(source, before);
  assert.ok(segments[0].points.every(({ segmentId }) => segmentId === "segment-1"));
});

for (const gap of [8_000, 60_000]) {
  test(`un gap de ${gap / 1_000} s crée un nouveau segment`, () => {
    const segments = buildFlightSegments([point({ timestamp: 0 }), point({ timestamp: gap })]);
    assert.equal(segments.length, 2);
    assert.equal(segments[1].breakReason, "TIME_GAP");
  });
}

test("une reprise background crée un nouveau segment", () => {
  const segments = buildFlightSegments([
    point({ timestamp: 0 }),
    point({ timestamp: 1_000, appState: "RESUME", firstFixAfterResume: true, quality: "SUSPECT", qualityReason: "BACKGROUND_RESUME" }),
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].breakReason, "BACKGROUND");
});

test("un premier fix imprécis après reprise coupe avec LOW_ACCURACY", () => {
  const segments = buildFlightSegments([
    point({ timestamp: 0 }),
    point({ timestamp: 1_000, appState: "RESUME", firstFixAfterResume: true, quality: "SUSPECT", qualityReason: "LOW_ACCURACY", horizontalAccuracyMeters: 80 }),
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].breakReason, "LOW_ACCURACY");
});

test("un point INVALID crée un nouveau segment sans être supprimé", () => {
  const segments = buildFlightSegments([
    point({ timestamp: 0 }),
    point({ timestamp: 1_000, quality: "INVALID", qualityReason: "POSITION_JUMP" }),
    point({ timestamp: 2_000 }),
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].breakReason, "INVALID_POINT");
  assert.equal(segments.flatMap(({ points }) => points).length, 3);
});

test("les statistiques ne relient jamais deux segmentId", () => {
  const points = [
    { ...point({ timestamp: 0, longitude: 3 }), segmentId: "segment-1" },
    { ...point({ timestamp: 1_000, longitude: 3.00001 }), segmentId: "segment-1" },
    { ...point({ timestamp: 2_000, longitude: 4 }), segmentId: "segment-2" },
    { ...point({ timestamp: 3_000, longitude: 4.00001 }), segmentId: "segment-2" },
  ];
  assert.ok(recalculateFlightStatistics(points).distanceMeters < 10);
});

test("compatibilité : segmentId absent signifie un seul segment statistique", () => {
  const points = [point({ timestamp: 0, longitude: 3 }), point({ timestamp: 60_000, longitude: 3.001 })];
  const statistics = recalculateFlightStatistics(points);
  assert.ok(statistics.distanceMeters > 70);
});

test("une liaison de gap plausible augmente uniquement la distance totale", () => {
  const points = [
    { ...point({ timestamp: 0, longitude: 3, speedMetersPerSecond: 5 }), segmentId: "segment-1" },
    { ...point({ timestamp: 1_000, longitude: 3.00001, speedMetersPerSecond: 5 }), segmentId: "segment-1" },
    { ...point({ timestamp: 11_000, longitude: 3.001, speedMetersPerSecond: 5 }), segmentId: "segment-2" },
    { ...point({ timestamp: 12_000, longitude: 3.00101, speedMetersPerSecond: 5 }), segmentId: "segment-2" },
  ];
  const withoutLink = recalculateFlightStatistics(points, 0, 12_000, { maxGapSpeedMetersPerSecond: 0 });
  const withLink = recalculateFlightStatistics(points);
  assert.ok(withLink.distanceMeters > withoutLink.distanceMeters);
  assert.equal(withLink.averageGroundSpeedMetersPerSecond, withoutLink.averageGroundSpeedMetersPerSecond);
  assert.equal(withLink.maxGroundSpeedMetersPerSecond, withoutLink.maxGroundSpeedMetersPerSecond);
  assert.equal(withLink.maximumClimbRateMetersPerSecond, withoutLink.maximumClimbRateMetersPerSecond);
  assert.equal(withLink.maximumDescentRateMetersPerSecond, withoutLink.maximumDescentRateMetersPerSecond);
});

test("une liaison trop rapide ou bordée par INVALID reste à zéro", () => {
  const fast = [
    { ...point({ timestamp: 0, longitude: 3 }), segmentId: "segment-1" },
    { ...point({ timestamp: 1_000, longitude: 4 }), segmentId: "segment-2" },
  ];
  const invalid = [
    { ...point({ timestamp: 0, longitude: 3, quality: "INVALID" }), segmentId: "segment-1" },
    { ...point({ timestamp: 10_000, longitude: 3.0001 }), segmentId: "segment-2" },
  ];
  assert.deepEqual(calculateFlightGapDistanceLinks(fast).map(({ retained, reason }) => ({ retained, reason })), [
    { retained: false, reason: "SPEED_ABOVE_LIMIT" },
  ]);
  assert.deepEqual(calculateFlightGapDistanceLinks(invalid).map(({ retained, reason }) => ({ retained, reason })), [
    { retained: false, reason: "INVALID_POINT" },
  ]);
});
