import assert from "node:assert/strict";
import test from "node:test";
import {
  getAirspaceEvaluationVersion,
  getCoverageEvaluationVersion,
  shouldUpdateFlightContext,
} from "./flightContextEvaluation.ts";

function position(overrides = {}) {
  return {
    latitude: 50,
    longitude: 3,
    altitude: 100,
    accuracy: 5,
    verticalAccuracy: 8,
    timestamp: 1,
    speed: 1,
    heading: 90,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    position: position(),
    gpsStatus: "ACTIVE",
    airspaceVersion: "airspaces-v1",
    coverageVersion: "coverage-v1",
    airspaceDataAvailable: true,
    ...overrides,
  };
}

test("un contexte sémantiquement identique ne déclenche aucun update", () => {
  assert.equal(
    shouldUpdateFlightContext(snapshot(), snapshot({ position: position() })),
    false,
  );
});

test("une variation GPS pertinente déclenche exactement une décision d’update", () => {
  const previous = snapshot();
  const moved = snapshot({ position: position({ latitude: 50.001 }) });
  assert.equal(shouldUpdateFlightContext(previous, moved), true);
  assert.equal(shouldUpdateFlightContext(moved, moved), false);
});

test("un changement aéronautique pertinent déclenche un update", () => {
  assert.equal(
    shouldUpdateFlightContext(
      snapshot(),
      snapshot({ airspaceVersion: "airspaces-v2" }),
    ),
    true,
  );
});

test("les signatures restent stables pour de nouvelles références identiques", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "ctr",
        geometry: { type: "Polygon", coordinates: [] },
        properties: {
          airspaceId: "ctr",
          type: 4,
          icaoClass: 3,
          lowerLimit: null,
          upperLimit: null,
        },
      },
    ],
  };
  assert.equal(
    getAirspaceEvaluationVersion(collection),
    getAirspaceEvaluationVersion(structuredClone(collection)),
  );
  assert.equal(
    getCoverageEvaluationVersion([
      { latitude: 50, longitude: 3, radiusMeters: 45_000 },
    ]),
    getCoverageEvaluationVersion([
      { latitude: 50, longitude: 3, radiusMeters: 45_000 },
    ]),
  );
});
