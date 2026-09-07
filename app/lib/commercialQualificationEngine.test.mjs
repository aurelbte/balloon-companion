import assert from "node:assert/strict";
import test from "node:test";
import { calculateBplMaintenance } from "./bplQualificationEngine.ts";
import { calculateCommercialQualification } from "./commercialQualificationEngine.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";

const hotAir = { classId: "HOT_AIR_BALLOON" };
const gas = { classId: "GAS_BALLOON" };
const commercialProfile = { licenceType: "BPL", commercialOperationsEnabled: true, fiBEnabled: false, feBEnabled: false };
let sequence = 100;

function ascension(id, dateIso, category = "Libre à air chaud", pilotFunction = "Pilote", details = {}) {
  return { id, sourceFlightId: null, source: "MANUAL", dateIso, date: dateIso, balloonModel: "Z105", registration: "F-TEST", departure: "A", arrival: "B", category, pilotFunction, regulatoryRole: pilotFunction === "Élève" ? "DUAL" : "PIC", supervisedByFiB: false, nightFlight: false, maximumAltitudeM: null, gpsDurationMinutes: null, officialDurationMinutes: 60, observations: "", ...details };
}

function event(type, dateIso, details = {}) {
  sequence += 1;
  return createQualificationEvent({ type, dateIso, source: "MANUAL", ...details }, { uuid: () => `123e4567-e89b-42d3-a456-${String(sequence).padStart(12, "0")}`, now: () => new Date("2026-08-20T00:00:00Z") });
}

function calculate(overrides = {}) {
  return calculateCommercialQualification({ profile: commercialProfile, events: [], ascensions: [], referenceDateIso: "2026-08-20", balloonClass: hotAir, ascensionHistoryComplete: true, ...overrides });
}

test("trois vols PIC satisfont la récence à la frontière des 180 jours", () => {
  const result = calculate({ ascensions: [ascension("boundary", "2026-02-21"), ascension("two", "2026-04-01", "Libre à gaz"), ascension("three", "2026-06-01", "Libre à gaz"), ascension("outside", "2026-02-20")] });
  assert.equal(result.recency.status, "COMPLIANT");
  assert.deepEqual(result.recency.currentValue, { picFlights: 3, flightsInClass: 1, supervisedFlightsInClass: 0 });
});

test("l’accès initial est requis et reste distinct des voies de maintien", () => {
  const missing = calculate({ ascensions: [ascension("one", "2026-04-01"), ascension("two", "2026-05-01"), ascension("three", "2026-06-01")] });
  assert.equal(missing.initialAccess.status, "UNKNOWN");
  assert.equal(missing.overall.status, "UNKNOWN");
  assert.equal(missing.proficiencyCheckFeB.status, "ACTION_REQUIRED");
  assert.equal(missing.refresherCourse.status, "ACTION_REQUIRED");
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2026-01-01", { balloonClass: hotAir });
  const result = calculate({ events: [issuance], ascensions: [ascension("one", "2026-04-01"), ascension("two", "2026-05-01"), ascension("three", "2026-06-01")] });
  assert.equal(result.initialAccess.status, "COMPLIANT");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("un vol PIC supervisé par FI(B) dans la classe suffit", () => {
  const flight = ascension("supervised", "2026-07-01", "Libre à air chaud", "Pilote", { supervisedByFiB: true });
  const training = event("TRAINING_FLIGHT_BPL", "2026-07-01", { officialAscensionId: flight.id, balloonClass: hotAir, instructor: { name: "FI Test" } });
  const result = calculate({ ascensions: [flight], events: [training] });
  assert.equal(result.recency.status, "COMPLIANT");
  assert.deepEqual(result.recency.sourceEventIds, [training.id]);
});

test("un contrôle commercial FE(B) est valable jusqu’à la frontière des 24 mois", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2024-08-20", { balloonClass: hotAir, examiner: { name: "FE Test" } });
  assert.equal(calculate({ events: [issuance, check] }).proficiencyCheckFeB.status, "WARNING");
  assert.equal(calculate({ events: [issuance, check], referenceDateIso: "2026-08-21" }).proficiencyCheckFeB.status, "ACTION_REQUIRED");
});

test("un contrôle valide satisfait le maintien mais jamais la récence", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: hotAir, examiner: { name: "FE Test" } });
  const result = calculate({ events: [issuance, check] });
  assert.equal(result.recency.status, "ACTION_REQUIRED");
  assert.equal(result.maintenance.status, "COMPLIANT");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("le cours exige six heures de théorie et un vol lié avec FI(B)", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-11", { balloonClass: hotAir, instructor: { name: "FI Test" } });
  const course = event("COMMERCIAL_REFRESHER_COURSE", "2026-01-10", { balloonClass: hotAir, theoryMinutes: 360, relatedEventIds: [training.id], commercialQualifiedFiB: true });
  const result = calculate({ events: [issuance, course, training] });
  assert.equal(result.refresherCourse.status, "COMPLIANT");
  assert.deepEqual(result.refresherCourse.sourceEventIds, [course.id, training.id]);
  const shortCourse = event("COMMERCIAL_REFRESHER_COURSE", "2026-01-10", { balloonClass: hotAir, theoryMinutes: 359, relatedEventIds: [training.id] });
  assert.equal(calculate({ events: [issuance, shortCourse, training] }).refresherCourse.status, "ACTION_REQUIRED");
});

test("une remise à niveau complète satisfait la voie alternative lorsque pertinente", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-11", { balloonClass: hotAir, instructor: { name: "FI Test" } });
  const course = event("COMMERCIAL_REFRESHER_COURSE", "2026-01-10", { balloonClass: hotAir, theoryMinutes: 360, relatedEventIds: [training.id], commercialQualifiedFiB: true });
  const result = calculate({ events: [issuance, course, training] });
  assert.equal(result.maintenance.status, "COMPLIANT");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("une preuve d’une autre classe ne donne aucune conformité", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: gas, examiner: { name: "FE Test" } });
  assert.equal(calculate({ events: [issuance, check] }).proficiencyCheckFeB.status, "ACTION_REQUIRED");
});

test("un historique incomplet retourne UNKNOWN si les preuves sont insuffisantes", () => {
  assert.equal(calculate({ ascensions: [ascension("one", "2026-01-01")], ascensionHistoryComplete: false }).recency.status, "UNKNOWN");
});

test("la couverture partielle sur 180 jours reste UNKNOWN malgré deux vols connus", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2025-01-01", { balloonClass: hotAir });
  const result = calculate({ events: [issuance], ascensions: [ascension("one", "2026-05-01"), ascension("two", "2026-06-01")], historyCoverageStartDate: "2026-04-01" });
  assert.equal(result.recency.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "ACTION_REQUIRED");
});

test("la couverture complète sur 180 jours conserve la conclusion existante", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2025-01-01", { balloonClass: hotAir });
  const result = calculate({ events: [issuance], ascensions: [ascension("one", "2026-05-01"), ascension("two", "2026-06-01")], historyCoverageStartDate: "2026-02-21" });
  assert.equal(result.recency.status, "ACTION_REQUIRED");
});

test("la déclaration commerciale est propre à la classe et ne remplace pas la délivrance", () => {
  const declaredProfile = { ...commercialProfile, declaredCommercialInitialSituations: [{ balloonClass: hotAir, referenceDateIso: "2026-08-01", recencySatisfied: true }] };
  const withoutIssuance = calculate({ profile: declaredProfile, ascensionHistoryComplete: false });
  assert.equal(withoutIssuance.recency.status, "COMPLIANT");
  assert.equal(withoutIssuance.recency.provenance, "DECLARED_BY_PILOT");
  assert.equal(withoutIssuance.overall.status, "UNKNOWN");
  const gasResult = calculate({ profile: declaredProfile, balloonClass: gas, ascensionHistoryComplete: false });
  assert.equal(gasResult.recency.status, "UNKNOWN");
});

test("l’historique commercial complet reprend automatiquement la main", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2025-01-01", { balloonClass: hotAir });
  const declaredProfile = { ...commercialProfile, declaredCommercialInitialSituations: [{ balloonClass: hotAir, referenceDateIso: "2026-08-01", recencySatisfied: true }] };
  const result = calculate({ profile: declaredProfile, events: [issuance], historyCoverageStartDate: "2026-02-21" });
  assert.equal(result.recency.status, "ACTION_REQUIRED");
  assert.equal(result.recency.provenance, undefined);
});

test("l’activité commerciale désactivée est NON_APPLICABLE", () => {
  const profile = { ...commercialProfile, commercialOperationsEnabled: false };
  const result = calculate({ profile });
  assert.equal(result.overall.status, "NON_APPLICABLE");
  assert.equal(result.recency.status, "NON_APPLICABLE");
});

test("les événements commerciaux produisent des crédits BPL sans changer de type", () => {
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: hotAir, examiner: { name: "FE Test" } });
  const bpl = calculateBplMaintenance({ profile: commercialProfile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(check.type, "COMMERCIAL_PROFICIENCY_CHECK");
  assert.equal(bpl.proficiencyCheckFeB.status, "COMPLIANT");
  assert.deepEqual(bpl.proficiencyCheckFeB.sourceEventIds, [check.id]);

  const groupedHotAir = { ...hotAir, groupId: "C" };
  const training = event("TRAINING_FLIGHT_BPL", "2026-02-01", { balloonClass: groupedHotAir, instructor: { name: "FI Test" } });
  const course = event("COMMERCIAL_REFRESHER_COURSE", "2026-02-02", { balloonClass: groupedHotAir, theoryMinutes: 360, relatedEventIds: [training.id] });
  const credited = calculateBplMaintenance({ profile: commercialProfile, events: [course, training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(course.type, "COMMERCIAL_REFRESHER_COURSE");
  assert.deepEqual(credited.trainingFlightFiB.sourceEventIds, [course.id, training.id]);
});

test("la classe cible expose un groupe futur sans supposer sa correspondance", () => {
  const target = { classId: "HOT_AIR_BALLOON", groupId: "GROUP_A" };
  const result = calculate({ balloonClass: target, ascensions: [ascension("one", "2026-01-01")], ascensionHistoryComplete: false });
  assert.deepEqual(result.balloonClass, target);
  assert.equal(result.recency.status, "UNKNOWN");
});

test("la récence compte exclusivement les PIC explicites", () => {
  const roles = ["FI_B", "FE_B", "DUAL", null];
  const flights = [ascension("pic", "2026-05-01"), ...roles.map((regulatoryRole, index) => ascension(`excluded-${index}`, "2026-05-02", "Libre à air chaud", "Pilote", { regulatoryRole }))];
  const result = calculate({ ascensions: flights });
  assert.equal(result.recentPicFlights180d, 1);
  assert.equal(result.recency.status, "ACTION_REQUIRED");
});

test("trois PIC sans vol dans la classe cible restent insuffisants", () => {
  const flights = [1, 2, 3].map((id) => ascension(`gas-${id}`, "2026-05-01", "Libre à gaz"));
  assert.equal(calculate({ ascensions: flights }).recency.status, "ACTION_REQUIRED");
});

test("l'alternative exige PIC supervisé et événement FI(B) lié", () => {
  const plain = ascension("plain", "2026-07-01");
  const supervised = ascension("supervised-explicit", "2026-07-02", "Libre à air chaud", "Pilote", { supervisedByFiB: true });
  const orphanTraining = event("TRAINING_FLIGHT_BPL", "2026-07-01", { officialAscensionId: plain.id, balloonClass: hotAir, instructor: { name: "FI" } });
  assert.equal(calculate({ ascensions: [plain], events: [orphanTraining] }).supervisedPicAlternativeStatus, "ACTION_REQUIRED");
  assert.equal(calculate({ ascensions: [supervised], events: [] }).supervisedPicAlternativeStatus, "ACTION_REQUIRED");
  const linked = event("TRAINING_FLIGHT_BPL", "2026-07-02", { officialAscensionId: supervised.id, balloonClass: hotAir, instructor: { name: "FI" } });
  assert.equal(calculate({ ascensions: [supervised], events: [linked] }).supervisedPicAlternativeStatus, "COMPLIANT");
});

test("le refresher exige 360 minutes, un training récent et la preuve FI commerciale", () => {
  const oldTraining = event("TRAINING_FLIGHT_BPL", "2024-08-19", { balloonClass: hotAir, instructor: { name: "FI" } });
  const recentTraining = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: hotAir, instructor: { name: "FI" } });
  const course = (training, extra = {}) => event("COMMERCIAL_REFRESHER_COURSE", "2026-02-01", { balloonClass: hotAir, theoryMinutes: 360, relatedEventIds: [training.id], ...extra });
  assert.equal(calculate({ events: [oldTraining, course(oldTraining, { commercialQualifiedFiB: true })] }).refresherStatus, "ACTION_REQUIRED");
  assert.equal(calculate({ events: [recentTraining, course(recentTraining)] }).refresherStatus, "UNKNOWN");
  assert.equal(calculate({ events: [recentTraining, course(recentTraining, { commercialQualifiedFiB: false })] }).refresherStatus, "ACTION_REQUIRED");
  assert.notEqual(calculate({ events: [recentTraining, course(recentTraining, { commercialQualifiedFiB: true })] }).refresherStatus, "ACTION_REQUIRED");
});

test("récence 180 jours et maintien 24 mois sont indépendants", () => {
  const issuance = event("INITIAL_COMMERCIAL_ISSUANCE", "2024-01-01", { balloonClass: hotAir });
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: hotAir, examiner: { name: "FE" } });
  const threePic = [1, 2, 3].map((id) => ascension(`pic-${id}`, "2026-06-01"));
  assert.equal(calculate({ events: [issuance], ascensions: threePic }).overallStatus, "ACTION_REQUIRED");
  assert.equal(calculate({ events: [issuance, check], ascensions: [] }).overallStatus, "ACTION_REQUIRED");
  assert.equal(calculate({ events: [issuance, check], ascensions: threePic }).overallStatus, "COMPLIANT");
});

test("un legacy ambigu n'altère jamais une conclusion positive explicite", () => {
  const explicit = [1, 2, 3].map((id) => ascension(`explicit-${id}`, "2026-06-01"));
  const legacy = ascension("legacy", "2026-06-02", "Libre à air chaud", "Pilote", { regulatoryRole: null });
  assert.equal(calculate({ ascensions: [...explicit, legacy], ascensionHistoryComplete: false }).recency.status, "COMPLIANT");
});
