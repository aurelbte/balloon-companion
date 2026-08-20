import assert from "node:assert/strict";
import test from "node:test";
import { calculateBplMaintenance } from "./bplQualificationEngine.ts";
import { calculateCommercialQualification } from "./commercialQualificationEngine.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";

const hotAir = { classId: "HOT_AIR_BALLOON" };
const gas = { classId: "GAS_BALLOON" };
const commercialProfile = { licenceType: "BPL", commercialOperationsEnabled: true, fiBEnabled: false, feBEnabled: false };
let sequence = 100;

function ascension(id, dateIso, category = "Libre à air chaud", pilotFunction = "Pilote") {
  return { id, sourceFlightId: null, source: "MANUAL", dateIso, date: dateIso, balloonModel: "Z105", registration: "F-TEST", departure: "A", arrival: "B", category, pilotFunction, nightFlight: false, maximumAltitudeM: null, gpsDurationMinutes: null, officialDurationMinutes: 60, observations: "" };
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

test("un vol PIC supervisé par FI(B) dans la classe suffit", () => {
  const flight = ascension("supervised", "2026-07-01");
  const training = event("TRAINING_FLIGHT_BPL", "2026-07-01", { officialAscensionId: flight.id, balloonClass: hotAir, instructor: { name: "FI Test" } });
  const result = calculate({ ascensions: [flight], events: [training] });
  assert.equal(result.recency.status, "COMPLIANT");
  assert.deepEqual(result.recency.sourceEventIds, [training.id]);
});

test("un contrôle commercial FE(B) est valable jusqu’à la frontière des 24 mois", () => {
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2024-08-20", { balloonClass: hotAir, examiner: { name: "FE Test" } });
  assert.equal(calculate({ events: [check] }).proficiencyCheckFeB.status, "WARNING");
  assert.equal(calculate({ events: [check], referenceDateIso: "2026-08-21" }).proficiencyCheckFeB.status, "ACTION_REQUIRED");
});

test("le cours exige six heures de théorie et un vol lié avec FI(B)", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-11", { balloonClass: hotAir, instructor: { name: "FI Test" } });
  const course = event("COMMERCIAL_REFRESHER_COURSE", "2026-01-10", { balloonClass: hotAir, theoryMinutes: 360, relatedEventIds: [training.id] });
  const result = calculate({ events: [course, training] });
  assert.equal(result.refresherCourse.status, "COMPLIANT");
  assert.deepEqual(result.refresherCourse.sourceEventIds, [course.id, training.id]);
  const shortCourse = event("COMMERCIAL_REFRESHER_COURSE", "2026-01-10", { balloonClass: hotAir, theoryMinutes: 359, relatedEventIds: [training.id] });
  assert.equal(calculate({ events: [shortCourse, training] }).refresherCourse.status, "UNKNOWN");
});

test("une preuve d’une autre classe ne donne aucune conformité", () => {
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: gas, examiner: { name: "FE Test" } });
  assert.equal(calculate({ events: [check] }).proficiencyCheckFeB.status, "UNKNOWN");
});

test("un historique incomplet retourne UNKNOWN si les preuves sont insuffisantes", () => {
  assert.equal(calculate({ ascensions: [ascension("one", "2026-01-01")], ascensionHistoryComplete: false }).recency.status, "UNKNOWN");
});

test("l’activité commerciale désactivée est NON_APPLICABLE", () => {
  const profile = { ...commercialProfile, commercialOperationsEnabled: false };
  const result = calculate({ profile });
  assert.equal(result.overall.status, "NON_APPLICABLE");
  assert.equal(result.recency.status, "NON_APPLICABLE");
});

test("les événements commerciaux produisent des crédits BPL sans changer de type", () => {
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: hotAir, examiner: { name: "FE Test" } });
  const bpl = calculateBplMaintenance({ profile: commercialProfile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(check.type, "COMMERCIAL_PROFICIENCY_CHECK");
  assert.equal(bpl.proficiencyCheckFeB.status, "COMPLIANT");
  assert.deepEqual(bpl.proficiencyCheckFeB.sourceEventIds, [check.id]);

  const training = event("TRAINING_FLIGHT_BPL", "2026-02-01", { balloonClass: hotAir, instructor: { name: "FI Test" } });
  const course = event("COMMERCIAL_REFRESHER_COURSE", "2026-02-02", { balloonClass: hotAir, theoryMinutes: 360, relatedEventIds: [training.id] });
  const credited = calculateBplMaintenance({ profile: commercialProfile, events: [course, training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(course.type, "COMMERCIAL_REFRESHER_COURSE");
  assert.deepEqual(credited.trainingFlightFiB.sourceEventIds, [course.id, training.id]);
});

test("la classe cible expose un groupe futur sans supposer sa correspondance", () => {
  const target = { classId: "HOT_AIR_BALLOON", groupId: "GROUP_A" };
  const result = calculate({ balloonClass: target, ascensions: [ascension("one", "2026-01-01")], ascensionHistoryComplete: false });
  assert.deepEqual(result.balloonClass, target);
  assert.equal(result.recency.status, "UNKNOWN");
});
