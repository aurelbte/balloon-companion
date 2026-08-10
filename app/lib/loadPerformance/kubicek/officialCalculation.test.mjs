import assert from "node:assert/strict";
import test from "node:test";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";
import { findExactKubicekModel } from "../modelParameters/kubicekModels.ts";
import {
  calculateKubicekMassFromLiftUnits,
  calculateTemperatureAtMaximumAltitudeC,
  interpolateKubicekLoadingTable,
  lookupKubicekLiftUnits,
} from "./officialCalculation.ts";

const bb20 = findExactKubicekModel("BB20");
assert.ok(bb20);
const input = {
  manufacturer: "Kubíček", model: "BB20", applicableMtowKg: 630,
  balloonEquipmentWeightKg: 300, occupantsWeightKg: 150,
  launchElevationMslM: 0, plannedMaximumAltitudeMslM: 6000 * 0.3048,
  groundTemperature: { temperatureC: 17.8872, sourceModel: "TEST", forecastRun: "TEST", validTime: "TEST" },
};

test("cas officiel BB20 : 16,5 LU interpole exactement 533 kg", () => {
  assert.equal(bb20.volumeCuFt, 71_200);
  assert.equal(interpolateKubicekLoadingTable("BB20", 16), 517);
  assert.equal(interpolateKubicekLoadingTable("BB20", 17), 549);
  assert.equal(interpolateKubicekLoadingTable("BB20", 16.5), 533);
});

test("aucune extrapolation hors de 10 à 23 LU", () => {
  assert.equal(interpolateKubicekLoadingTable("BB20", 9.999), null);
  assert.equal(interpolateKubicekLoadingTable("BB20", 23.001), null);
});

test("lignes kg officielles B.3102 pages 5-4 et 5-5 représentatives", () => {
  assert.equal(interpolateKubicekLoadingTable("BB22E", 10), 355);
  assert.equal(interpolateKubicekLoadingTable("BB22E", 16), 569);
  assert.equal(interpolateKubicekLoadingTable("BB22E", 20), 680);
  assert.equal(interpolateKubicekLoadingTable("BB22E", 23), 680);
  assert.equal(interpolateKubicekLoadingTable("BB26E", 10), 420);
  assert.equal(interpolateKubicekLoadingTable("BB26E", 17), 714);
  assert.equal(interpolateKubicekLoadingTable("BB26E", 23), 730);
  assert.equal(interpolateKubicekLoadingTable("BB40D", 10), 646);
  assert.equal(interpolateKubicekLoadingTable("BB40D", 20), 1293);
  assert.equal(interpolateKubicekLoadingTable("BB40D", 23), 1310);
  assert.equal(interpolateKubicekLoadingTable("BB100D", 10), 1603);
  assert.equal(interpolateKubicekLoadingTable("BB100D", 20), 3200);
  assert.equal(interpolateKubicekLoadingTable("BB100D", 23), 3200);
  assert.equal(interpolateKubicekLoadingTable("BB184P", 10), 2950);
  assert.equal(interpolateKubicekLoadingTable("BB184P", 17), 5015);
  assert.equal(interpolateKubicekLoadingTable("BB184P", 23), 5095);
});

test("le Loading Chart vectoriel reproduit le cas officiel 6000 ft / 6 °C", () => {
  const liftUnits = lookupKubicekLiftUnits(6000 * 0.3048, 6);
  assert.ok(liftUnits !== null);
  assert.equal(Number(liftUnits.toFixed(1)), 16.5);
  assert.ok(Math.abs(liftUnits - 16.5) < 0.05);
});

test("le Loading Chart n'extrapole ni altitude, ni température, ni domaine LU", () => {
  assert.equal(lookupKubicekLiftUnits(-1, 6), null);
  assert.equal(lookupKubicekLiftUnits(30_001 * 0.3048, -40), null);
  assert.equal(lookupKubicekLiftUnits(6000 * 0.3048, -41), null);
  assert.equal(lookupKubicekLiftUnits(6000 * 0.3048, 36), null);
});

test("un point sur courbe et une altitude entre courbes utilisent seulement les points extraits", () => {
  const on6000 = lookupKubicekLiftUnits(6000 * 0.3048, 6);
  const on8000 = lookupKubicekLiftUnits(8000 * 0.3048, 6);
  const between = lookupKubicekLiftUnits(7000 * 0.3048, 6);
  assert.ok(on6000 !== null && on8000 !== null && between !== null);
  assert.equal(between, (on6000 + on8000) / 2);
});

test("les limites basse et haute présentes dans le JSON restent consultables", () => {
  assert.ok(lookupKubicekLiftUnits(0, 34) !== null);
  assert.ok(lookupKubicekLiftUnits(30_000 * 0.3048, -40) !== null);
});

test("MTOW et RMTOW explicites deviennent limitantes", () => {
  assert.equal(calculateKubicekMassFromLiftUnits({ ...input, applicableMtowKg: 520 }, bb20, 16.5)?.permittedTotalMassKg, 520);
  assert.equal(calculateKubicekMassFromLiftUnits({ ...input, applicableMtowKg: 500 }, bb20, 16.5)?.permittedTotalMassKg, 500);
});

test("la décroissance standard est appliquée et une hauteur négative est refusée", () => {
  assert.equal(calculateTemperatureAtMaximumAltitudeC({ groundTemperatureC: 17.8872, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 1828.8 }), 6);
  assert.equal(calculateTemperatureAtMaximumAltitudeC({ groundTemperatureC: 10, launchElevationMslM: 100, plannedMaximumAltitudeMslM: 99 }), null);
});

test("le dispatcher branche le cas officiel BB20 sans arrondir le résultat interne", () => {
  const result = calculateManufacturerLoad("Kubíček", "BB20", input);
  assert.equal(result?.status, "AVAILABLE");
  assert.equal(result?.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
  assert.ok(Math.abs(result.performanceLimitedMassKg - 534.267968) < 0.0001);
  assert.equal(result.permittedTotalMassKg, result.performanceLimitedMassKg);
});

test("les conditions hors graphique sont refusées sans fallback", () => {
  assert.deepEqual(calculateManufacturerLoad("Kubíček", "BB20", {
    ...input,
    groundTemperature: { ...input.groundTemperature, temperatureC: 100 },
  }), {
    status: "UNAVAILABLE",
    reasonCode: "CONDITIONS_OUTSIDE_METHOD_DOMAIN",
    message: "Altitude ou température hors du domaine officiel du Loading Chart Kubíček.",
  });
});
