import test from "node:test";
import assert from "node:assert/strict";
import {
  interpolateWindAtAltitude,
} from "./trajectory/interpolation.ts";
import {
  validateTrajectoryInput,
} from "./trajectory/validation.ts";
import {
  interpolateWindVectors,
  windDirectionFromToMovementDirection,
  windVectorToMovementComponents,
} from "./trajectory/windMath.ts";

const supportedModels = ["arome_seamless", "icon_seamless", "gfs_seamless"];

function validDraft(overrides = {}) {
  return {
    start: {
      name: "Terrain validé",
      latitude: 50.631,
      longitude: 3.058,
    },
    departureTime: "2026-07-27T06:00:00+02:00",
    durationSeconds: 2700,
    weatherModel: "arome_seamless",
    targetAltitudeAmslM: 300,
    ...overrides,
  };
}

test("valide des coordonnées WGS84 et refuse les coordonnées invalides", () => {
  const result = validateTrajectoryInput(validDraft(), supportedModels);
  assert.equal(result.start.latitude, 50.631);

  assert.throws(
    () =>
      validateTrajectoryInput(
        validDraft({
          start: { name: "Invalide", latitude: 91, longitude: 3 },
        }),
        supportedModels,
      ),
    { code: "INVALID_COORDINATES" },
  );
});

test("refuse une altitude cible absente", () => {
  assert.throws(
    () =>
      validateTrajectoryInput(
        validDraft({ targetAltitudeAmslM: null }),
        supportedModels,
      ),
    { code: "MISSING_TARGET_ALTITUDE" },
  );
});

test("refuse les taux nuls ou négatifs sans convertir une valeur vide", () => {
  const withoutRates = validateTrajectoryInput(validDraft(), supportedModels);
  assert.equal(withoutRates.climbRateMps, undefined);
  assert.equal(withoutRates.descentRateMps, undefined);

  assert.throws(
    () =>
      validateTrajectoryInput(validDraft({ climbRateMps: 0 }), supportedModels),
    { code: "INVALID_CLIMB_RATE" },
  );
  assert.throws(
    () =>
      validateTrajectoryInput(
        validDraft({ descentRateMps: -0.5 }),
        supportedModels,
      ),
    { code: "INVALID_DESCENT_RATE" },
  );
});

test("convertit directionFrom vers la direction de déplacement opposée", () => {
  assert.equal(windDirectionFromToMovementDirection(0), 180);
  assert.equal(windDirectionFromToMovementDirection(270), 90);
});

test("un vent du nord déplace la masse d’air vers le sud", () => {
  const components = windVectorToMovementComponents({
    directionFromDeg: 0,
    speedMps: 10,
  });
  assert.ok(Math.abs(components.eastMps) < 1e-9);
  assert.ok(components.northMps < -9.999);
});

test("interpole les vents par leurs composantes vectorielles", () => {
  const result = interpolateWindVectors(
    { directionFromDeg: 90, speedMps: 4 },
    { directionFromDeg: 90, speedMps: 8 },
    0.5,
  );
  assert.ok(Math.abs(result.speedMps - 6) < 1e-9);
  assert.ok(Math.abs(result.directionFromDeg - 90) < 1e-9);
});

test("interpole correctement 350° et 10° sans traverser 180°", () => {
  const result = interpolateWindVectors(
    { directionFromDeg: 350, speedMps: 10 },
    { directionFromDeg: 10, speedMps: 10 },
    0.5,
  );
  assert.ok(result.directionFromDeg < 1 || result.directionFromDeg > 359);
  assert.ok(result.speedMps > 9.8);
});

test("l’interpolation verticale utilise les hauteurs géopotentielles réelles", () => {
  const result = interpolateWindAtAltitude(
    [
      {
        pressureHpa: 1000,
        geopotentialHeightAmslM: 100,
        windSpeedMps: 4,
        windDirectionFromDeg: 270,
      },
      {
        pressureHpa: 950,
        geopotentialHeightAmslM: 500,
        windSpeedMps: 8,
        windDirectionFromDeg: 270,
      },
    ],
    300,
  );

  assert.equal(result.lowerLevel.geopotentialHeightAmslM, 100);
  assert.equal(result.upperLevel.geopotentialHeightAmslM, 500);
  assert.equal(result.ratio, 0.5);
  assert.ok(Math.abs(result.wind.speedMps - 6) < 1e-9);
});

test("le taux de descente est conservé sans créer de phase automatique", () => {
  const result = validateTrajectoryInput(
    validDraft({ descentRateMps: 1.2 }),
    supportedModels,
  );
  assert.equal(result.descentRateMps, 1.2);
  assert.equal("descentStartsAt" in result, false);
});
