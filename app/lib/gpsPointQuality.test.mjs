import assert from "node:assert/strict";
import test from "node:test";
import { classifyGpsPointQuality, classifyGpsTraceQuality } from "./gpsPointQuality.ts";

function point({
  timestamp = 0,
  latitude = 50,
  longitude = 3,
  altitudeMeters = 100,
  speedMetersPerSecond = 5,
  headingDegrees = 90,
  horizontalAccuracyMeters = 5,
  ...metadata
} = {}) {
  return {
    timestamp, latitude, longitude, altitudeMeters, speedMetersPerSecond,
    headingDegrees, horizontalAccuracyMeters, verticalAccuracyMeters: 8, ...metadata,
  };
}

test("un point normal est VALID", () => {
  assert.deepEqual(classifyGpsPointQuality([point()], point({ timestamp: 1_000, longitude: 3.00001 })), {
    quality: "VALID", reason: "NONE",
  });
});

test("une mauvaise accuracy est SUSPECT", () => {
  assert.deepEqual(classifyGpsPointQuality([], point({ horizontalAccuracyMeters: 80 })), {
    quality: "SUSPECT", reason: "LOW_ACCURACY",
  });
});

test("le premier fix après background est SUSPECT", () => {
  assert.deepEqual(classifyGpsPointQuality([point()], point({ timestamp: 1_000, appState: "RESUME", firstFixAfterResume: true })), {
    quality: "SUSPECT", reason: "BACKGROUND_RESUME",
  });
});

test("un saut isolé suivi d'un retour est INVALID sans supprimer le point", () => {
  const points = [
    point(),
    point({ timestamp: 1_000, latitude: 51 }),
    point({ timestamp: 2_000, latitude: 50.00001 }),
  ];
  const classified = classifyGpsTraceQuality(points);
  assert.equal(classified.length, points.length);
  assert.deepEqual(classified[1], { ...points[1], quality: "INVALID", qualityReason: "POSITION_JUMP" });
  assert.deepEqual(points[1], point({ timestamp: 1_000, latitude: 51 }));
});

test("une vitesse élevée soutenue pendant 20 secondes reste VALID", () => {
  const points = [0, 5_000, 10_000, 15_000, 20_000].map((timestamp, index) =>
    point({ timestamp, longitude: 3 + index * 0.0015, speedMetersPerSecond: 35 }),
  );
  const classified = classifyGpsTraceQuality(points);
  assert.ok(classified.every(({ quality }) => quality === "VALID"));
});

test("un fort vario soutenu plusieurs secondes reste VALID", () => {
  const points = [0, 2_000, 4_000, 6_000, 8_000].map((timestamp, index) =>
    point({ timestamp, altitudeMeters: 100 + index * 30 }),
  );
  const classified = classifyGpsTraceQuality(points);
  assert.ok(classified.every(({ quality }) => quality === "VALID"));
});

test("un fort vario sur un seul point est SUSPECT", () => {
  const previous = point();
  const spike = point({ timestamp: 1_000, altitudeMeters: 140 });
  const next = point({ timestamp: 2_000, altitudeMeters: 101 });
  assert.deepEqual(classifyGpsPointQuality([previous], spike, [next]), {
    quality: "SUSPECT", reason: "ALTITUDE_SPIKE",
  });
});

test("un ancien point sans qualité reste classifiable et lisible", () => {
  const legacy = point();
  assert.equal(legacy.quality, undefined);
  assert.deepEqual(classifyGpsPointQuality([], legacy), { quality: "VALID", reason: "NONE" });
});
