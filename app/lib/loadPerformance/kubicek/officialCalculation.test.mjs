import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { kubicekB3102Ed3Rev23Source, kubicekB3102Ed3Rev23Rows, kubicekRev23CompatibilityRows, KUBICEK_MAXIMUM_ENVELOPE_TEMPERATURE_C } from "../datasets/kubicekB3102Ed3Rev23.ts";
import { kubicekMinimumLandingMassKg } from "./validation.ts";
import { createHash } from "node:crypto";
import { kubicekModelParameters } from "../modelParameters/kubicekModels.ts";
import { calculateOfficialLoad } from "../engine.ts";
import { kubicekBB74ZDocumentation, kubicekB3102Ed3Rev22Source, kubicekB3102Ed3Rev22Rows } from "../datasets/kubicekB3102Ed3Rev22.ts";
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
  manufacturer: "Kubíček", model: "BB20", volumeM3: 2000, applicableMtowKg: 630,
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

test("le Loading Chart conserve le point extrait et distingue la lecture constructeur sans arrondi imposé", () => {
  const liftUnits = lookupKubicekLiftUnits(6000 * 0.3048, 6);
  assert.ok(liftUnits !== null);
  assert.equal(liftUnits, 16.539624);
  assert.notEqual(liftUnits, 16.5);
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
  assert.equal(calculateKubicekMassFromLiftUnits({ ...input, applicableMtowKg: 520 }, bb20, 16.5)?.candidateMassCeilingKg, 520);
  assert.equal(calculateKubicekMassFromLiftUnits({ ...input, applicableMtowKg: 500 }, bb20, 16.5)?.candidateMassCeilingKg, 500);
});

test("la décroissance standard est appliquée et une hauteur négative est refusée", () => {
  assert.equal(calculateTemperatureAtMaximumAltitudeC({ groundTemperatureC: 17.8872, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 1828.8 }), 6);
  assert.equal(calculateTemperatureAtMaximumAltitudeC({ groundTemperatureC: 10, launchElevationMslM: 100, plannedMaximumAltitudeMslM: 99 }), null);
});

test("le dispatcher branche le cas officiel BB20 sans arrondir le résultat interne", () => {
  const result = calculateManufacturerLoad("Kubíček", "BB20", input);
  assert.equal(result?.status, "NON_VALIDÉ");
  assert.equal(result.theoretical.performanceLimitedMassKg, 534.267968);
  assert.equal(result.theoretical.candidateMassCeilingKg, 534.267968);
  assert.ok(result.reasons.includes("LU_METHOD_NOT_VALIDATED"));
  assert.equal("marginKg" in result, false);
  assert.equal("permittedTotalMassKg" in result, false);
});

test("les conditions hors graphique sont refusées sans fallback", () => {
  assert.deepEqual(calculateManufacturerLoad("Kubíček", "BB20", {
    ...input,
    groundTemperature: { ...input.groundTemperature, temperatureC: 100 },
  }), {
    status: "UNAVAILABLE",
    reasonCode: "OUTSIDE_OFFICIAL_TABLE",
    message: "Altitude ou température hors du domaine officiel du Loading Chart Kubíček.",
  });
});


test("les 1106 valeurs des 79 tables historiques restent strictement inchangées", () => {
  const models = kubicekModelParameters.map(({ model }) => model).filter((model) => model.startsWith("BB") && model !== "BB74Z").sort();
  assert.equal(models.length, 79);
  const tables = Object.fromEntries(models.map((model) => [model,
    Array.from({ length: 14 }, (_, index) => interpolateKubicekLoadingTable(model, index + 10)),
  ]));
  // Empreinte des 79 lignes avant consolidation Rev.22 (clés triées, JSON compact).
  assert.equal(createHash("sha256").update(JSON.stringify(tables)).digest("hex"),
    "b8215eff545a265c37056e8b4a5aea9c7c174eec727bb61c91d9b5d0cc9a90e0");
});

test("BB74Z : archive Rev.22 préservée et modèles actuels non activés", () => {
  const parameters = findExactKubicekModel("BB74Z");
  assert.ok(parameters);
  assert.equal(parameters.volumeM3, 7400);
  assert.equal(parameters.volumeCuFt, 263400);
  assert.equal(parameters.standardMtomKg, 2450);
  assert.equal(kubicekBB74ZDocumentation.minimumLandingWeightKg, 1130);
  assert.deepEqual(Array.from({ length: 14 }, (_, i) => interpolateKubicekLoadingTable("BB74Z", i + 10)),
    [1196,1315,1435,1554,1674,1794,1913,2033,2152,2272,2391,2450,2450,2450]);
  assert.equal(interpolateKubicekLoadingTable("BB74Z", 10.5), 1255.5);
  assert.deepEqual(kubicekBB74ZDocumentation.basketMatrix.row, ["BB70D", "BB70Z", "BB74Z"]);
  assert.deepEqual(kubicekBB74ZDocumentation.burnerMatrix.row, ["BB74Z", "BB78Z"]);
  assert.equal(kubicekBB74ZDocumentation.configurationStatus, "NOT_VERIFIED");
  assert.equal(kubicekB3102Ed3Rev22Source.pageRevisions["8-1"].revision, 15);
  for (const page of ["2-5", "2-9", "2-10", "2-11", "5-4", "5-5", "8-2"]) {
    assert.equal(kubicekB3102Ed3Rev22Source.pageRevisions[page].revision, 22);
  }
  assert.deepEqual(kubicekB3102Ed3Rev22Rows, []);
  for (const model of kubicekModelParameters) {
    const result = calculateOfficialLoad({ ...input, balloonId: "TEST", model: model.model, volumeM3: model.volumeM3, applicableMtowKg: model.standardMtomKg, configurationLimitsConfirmed: true });
    assert.equal(result.status, "UNAVAILABLE", model.model);
    assert.equal(result.reasonCode, "PENDING_VERIFICATION", model.model);
    assert.match(result.message, /LU_METHOD_NOT_VALIDATED/);
    assert.equal("marginKg" in result, false);
  }
});


test("Rev.23 : Origo 15 vérifié p.5-4, Origo 18 partage BB18E, volumes documentaires exacts", () => {
  const a=findExactKubicekModel("Origo 15"), b=findExactKubicekModel("Origo 18");
  assert.deepEqual([a.volumeM3,a.volumeCuFt,a.standardMtomKg,kubicekMinimumLandingMassKg(a.model)],[1500,53000,450,220]);
  assert.deepEqual([b.volumeM3,b.volumeCuFt,b.standardMtomKg,kubicekMinimumLandingMassKg(b.model)],[1800,64100,550,255]);
  assert.deepEqual(Array.from({length:14},(_,i)=>interpolateKubicekLoadingTable(a.model,i+10)),[250,275,301,326,351,376,401,426,450,450,450,450,450,450]);
  assert.equal(interpolateKubicekLoadingTable(a.model,13.5),338.5);
  for(let lu=10;lu<=23;lu++) assert.equal(interpolateKubicekLoadingTable(b.model,lu),interpolateKubicekLoadingTable("BB18E",lu));
  assert.equal(findExactKubicekModel("ORIGO15"),undefined); // No undocumented alias.
});

test("Rev.23 préserve les 80 lignes BB en kg et le fichier des 713 points LU, octet pour octet",()=>{
  const models=kubicekModelParameters.map(p=>p.model).filter(m=>m.startsWith("BB")).sort();
  assert.equal(models.length,80);
  const rows=Object.fromEntries(models.map(m=>[m,Array.from({length:14},(_,i)=>interpolateKubicekLoadingTable(m,i+10))]));
  assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"),"96401ba5f362b5de4952eab21cd13e725028970c2b1b525f77fdb95cbf34d2cc");
  assert.equal(createHash("sha256").update(readFileSync(new URL("../datasets/audits/kubicek-b3102-ed3-rev19-loading-chart.json",import.meta.url))).digest("hex"),"748ecb76f300c011d7a11dac928133aa581cdd4efd9084b853efa21afd0368e4");
});

test("traçabilité Rev.23 distincte, correction lb documentaire seulement, aucune activation",()=>{
  assert.equal(kubicekB3102Ed3Rev23Source.manualId,"KUBICEK_B3102_ED3_REV23");
  assert.equal(kubicekB3102Ed3Rev23Source.pageRevisions["5-3"],17);
  assert.equal(kubicekB3102Ed3Rev23Source.pageRevisions["8-2"],22);
  assert.equal(kubicekB3102Ed3Rev23Source.loadingChartChanged,false);
  assert.equal(kubicekB3102Ed3Rev23Source.loadingTableUnit,"kg");
  assert.deepEqual(kubicekB3102Ed3Rev23Rows,[]);
  assert.deepEqual(kubicekB3102Ed3Rev23Source.unusedPoundTableCorrection,{models:["BB16","BB16E","BB16EF","BB16XR"],liftUnits:[19,20,21,22,23],valueLb:1035});
  assert.equal(KUBICEK_MAXIMUM_ENVELOPE_TEMPERATURE_C,124);
  for(const model of ["BB74Z","BB78Z"]) {
    assert.deepEqual(kubicekRev23CompatibilityRows[model].burnerRow,[model]);
    assert.equal(kubicekRev23CompatibilityRows[model].ignisTwoUnitsMinimumSerial,516);
  }
});
