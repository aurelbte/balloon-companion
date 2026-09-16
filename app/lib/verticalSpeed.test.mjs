import assert from "node:assert/strict";
import test from "node:test";
import { estimateVerticalSpeed } from "./geo.ts";
import { recordedFlightPointToGeoPoint } from "./recordedFlight.ts";

const point = (altitude, timestamp, changes = {}) => ({ latitude: 50, longitude: 3, altitude, timestamp, speed: 3, heading: 90, accuracy: 5, verticalAccuracy: 8, ...changes });
const fixes = (altitudes) => altitudes.map((altitude, index) => point(altitude, index * 1_000));

for (const [name, altitudes, expected] of [
  ["montée", [100, 102, 104, 106, 108], 2],
  ["descente", [108, 106, 104, 102, 100], -2],
  ["palier", [100, 100, 100, 100, 100], 0],
]) test(`vario ${name} : pente et fenêtre de cinq fixes conservées`, () => {
  assert.equal(estimateVerticalSpeed(fixes(altitudes), 5), expected);
});

test("verticalAccuracy inconnue, invalide ou dégradée : indisponible, jamais zéro inventé", () => {
  for (const verticalAccuracy of [null, undefined, NaN, Infinity, -1, 26, 100]) {
    const points = fixes([100, 102, 104]).map((p) => ({ ...p, verticalAccuracy }));
    assert.equal(estimateVerticalSpeed(points), null);
  }
  assert.equal(estimateVerticalSpeed(fixes([100, 102]).map((p) => ({ ...p, verticalAccuracy: 25 }))), 2);
});

test("fix suspect/invalide : coupe l'estimation, puis exige deux nouveaux fixes exploitables", () => {
  for (const quality of ["SUSPECT", "INVALID"]) {
    const points = [...fixes([100, 102]), point(150, 2_000, { quality, qualityReason: "ALTITUDE_SPIKE" })];
    assert.equal(estimateVerticalSpeed(points, 5), null);
    points.push(point(106, 3_000));
    assert.equal(estimateVerticalSpeed(points, 5), null);
    points.push(point(108, 4_000));
    assert.equal(estimateVerticalSpeed(points, 5), 2);
  }
});

test("pic GPS non classifié : ne pas le diluer en taux vertical crédible", () => {
  assert.equal(estimateVerticalSpeed(fixes([100, 100, 100, 100, 125]), 5), null);
  assert.equal(estimateVerticalSpeed(fixes([100, 100, 140, 100, 100]), 5), null);
  assert.equal(estimateVerticalSpeed(fixes([100, 100, 100, 100, 75]), 5), null);
});

test("un taux fort réellement confirmé VALID n'est pas plafonné arbitrairement", () => {
  assert.equal(estimateVerticalSpeed(fixes([100, 112, 124]).map((p) => ({ ...p, quality: "VALID", qualityReason: "NONE" }))), 12);
});

test("gap GPS : aucune moyenne traversant la rupture de huit secondes", () => {
  const points = [...fixes([100, 102]), point(200, 9_000)];
  assert.equal(estimateVerticalSpeed(points, 5), null);
  points.push(point(202, 10_000));
  assert.equal(estimateVerticalSpeed(points, 5), 2);
  assert.equal(estimateVerticalSpeed([point(100, 0), point(102, 1_000, { deltaTimeSincePreviousPoint: 9_000 })]), null);
});

test("segments et reprise de premier plan : estimation interrompue", () => {
  assert.equal(estimateVerticalSpeed([point(100, 0, { segmentId: "a" }), point(102, 1_000, { segmentId: "b" })]), null);
  for (const changes of [{ firstFixAfterResume: true }, { appState: "RESUME" }, { qualityReason: "TIME_GAP" }]) {
    assert.equal(estimateVerticalSpeed([...fixes([100, 102]), point(104, 2_000, changes)]), null);
  }
});

test("insuffisance, altitudes invalides et timestamps désordonnés : indisponible", () => {
  for (const points of [[], fixes([100]), fixes([100, null]), fixes([100, NaN]), fixes([100, Infinity]), [point(100, 1_000), point(102, 1_000)], [point(100, 1_000), point(102, 0)]]) {
    assert.equal(estimateVerticalSpeed(points), null);
  }
});

test("la conversion des points enregistrés conserve qualité, raison et segment pour le vario", () => {
  const recorded = { timestamp: 1_000, latitude: 50, longitude: 3, altitudeMeters: 120, speedMetersPerSecond: 3, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8, quality: "SUSPECT", qualityReason: "ALTITUDE_SPIKE", segmentId: "b" };
  const converted = recordedFlightPointToGeoPoint(recorded);
  assert.equal(converted.quality, "SUSPECT");
  assert.equal(converted.qualityReason, "ALTITUDE_SPIKE");
  assert.equal(converted.segmentId, "b");
  assert.equal(estimateVerticalSpeed([point(100, 0), converted]), null);
});
