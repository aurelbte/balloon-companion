import assert from "node:assert/strict";
import test from "node:test";
import { calculateFilteredHorizontalDistance } from "./filteredHorizontalDistance.ts";

function point(index, xMeters, yMeters, overrides = {}) {
  return {
    timestamp: index * 1_000,
    latitude: 50 + yMeters / 111_320,
    longitude: 3 + xMeters / (111_320 * Math.cos(50 * Math.PI / 180)),
    altitudeMeters: 100 + index,
    speedMetersPerSecond: 3,
    headingDegrees: 90,
    horizontalAccuracyMeters: 2,
    verticalAccuracyMeters: 5,
    quality: "VALID",
    qualityReason: "NONE",
    segmentId: "segment-1",
    ...overrides,
  };
}

test("une trajectoire droite bruitée retire les oscillations latérales", () => {
  const points = [0, 1, 2, 3, 4, 5, 6].map((index) => point(index, index * 4, index % 2 === 0 ? -1.5 : 1.5));
  const result = calculateFilteredHorizontalDistance(points);
  assert.ok(result.filteredDistanceMeters < result.rawDistanceMeters);
  assert.ok(result.filteredDistanceMeters > 23);
});

test("un vrai virage progressif reste mesuré", () => {
  const points = [point(0, 0, 0), point(1, 4, 0), point(2, 8, 1), point(3, 11, 4), point(4, 12, 8), point(5, 12, 12)];
  const result = calculateFilteredHorizontalDistance(points);
  assert.ok(result.filteredDistanceMeters > 17);
  assert.ok(result.filteredDistanceMeters / result.rawDistanceMeters > 0.85);
});

test("un vrai zigzag prolongé de couche de vent reste mesuré", () => {
  const points = [point(0, 0, 0), point(1, 3, 0), point(2, 6, 1), point(3, 8, 3), point(4, 8, 6), point(5, 7, 9), point(6, 5, 12), point(7, 3, 14)];
  const result = calculateFilteredHorizontalDistance(points);
  assert.ok(result.filteredDistanceMeters / result.rawDistanceMeters > 0.8);
});

test("un aller-retour isolé de deux mètres dans l'accuracy est neutralisé", () => {
  const result = calculateFilteredHorizontalDistance([point(0, 0, 0), point(1, 2, 0), point(2, 0, 0)]);
  assert.ok(result.filteredDistanceMeters < 0.1);
  assert.equal(result.neutralizedMicroOscillations, 1);
});

test("un déplacement lent mais soutenu est conservé", () => {
  const points = [0, 1, 2, 3, 4, 5].map((index) => point(index, index, 0));
  const result = calculateFilteredHorizontalDistance(points);
  assert.ok(Math.abs(result.filteredDistanceMeters - 5) < 0.1);
});

test("deux segments ne sont jamais reliés par le filtre", () => {
  const points = [point(0, 0, 0), point(1, 2, 0), point(2, 100, 0, { segmentId: "segment-2" }), point(3, 102, 0, { segmentId: "segment-2" })];
  assert.ok(calculateFilteredHorizontalDistance(points).filteredDistanceMeters < 5);
});
