import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarMonths, calculateBplMaintenance, calculateDatedExperience } from "./bplQualificationEngine.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";

const profile = { licenceType: "BPL", commercialOperationsEnabled: false, fiBEnabled: false, feBEnabled: false };
let sequence = 0;

function ascension(id, dateIso, minutes = 60, movements) {
  return { id, sourceFlightId: null, source: "MANUAL", dateIso, date: dateIso, balloonModel: "Z105", registration: "F-TEST", departure: "A", arrival: "B", category: "Libre à air chaud", pilotFunction: "Pilote", nightFlight: false, maximumAltitudeM: null, gpsDurationMinutes: null, officialDurationMinutes: minutes, observations: "", ...(movements ?? {}) };
}

function event(type, dateIso, person = {}) {
  sequence += 1;
  return createQualificationEvent({ type, dateIso, source: "MANUAL", ...person }, { uuid: () => `123e4567-e89b-42d3-a456-${String(sequence).padStart(12, "0")}`, now: () => new Date("2026-08-20T00:00:00Z") });
}

test("la fenêtre 24 mois inclut la frontière et exclut openingBalance", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [ascension("inside", "2024-08-20", 360, { takeoffCount: 10, landingCount: 10 }), ascension("outside", "2024-08-19", 600)], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, openingBalance: { confirmed: true, ascensions: 100, officialDurationMinutes: 10_000 } });
  assert.equal(result.datedExperience.officialDurationMinutes, 360);
  assert.equal(result.recentExperience.status, "COMPLIANT");
  assert.equal(result.excludedOpeningBalance.officialDurationMinutes, 10_000);
});

test("le fallback historique compte un mouvement de chaque sorte par ascension", () => {
  const flights = Array.from({ length: 10 }, (_, index) => ascension(`a-${index}`, "2026-01-01", 36));
  const result = calculateDatedExperience(flights, "2026-08-20");
  assert.equal(result.officialDurationMinutes, 360);
  assert.equal(result.takeoffs, 10);
  assert.equal(result.landings, 10);
  assert.equal(result.legacyMovementFallbackAscensionIds.length, 10);
  assert.equal(result.byCategory["Libre à air chaud"].ascensions, 10);
});

test("les compteurs explicites supportent plusieurs mouvements", () => {
  const result = calculateDatedExperience([ascension("multi", "2026-01-01", 360, { takeoffCount: 10, landingCount: 12 })], "2026-08-20");
  assert.deepEqual([result.ascensions, result.takeoffs, result.landings], [1, 10, 12]);
  assert.deepEqual(result.legacyMovementFallbackAscensionIds, []);
});

test("la voie FI(B) suit exactement 48 mois", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2022-08-20", { instructor: { name: "FI Test" } });
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const boundary = calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(boundary.trainingFlightFiB.dueDate, "2026-08-20");
  assert.equal(boundary.trainingFlightFiB.status, "WARNING");
  assert.equal(boundary.overall.status, "COMPLIANT");
  assert.equal(calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-08-21", ascensionHistoryComplete: true }).trainingFlightFiB.status, "ACTION_REQUIRED");
});

test("la voie FE(B) alternative suit exactement 24 mois", () => {
  const check = event("PROFICIENCY_CHECK_BPL", "2024-08-20", { examiner: { name: "FE Test" } });
  const boundary = calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(boundary.proficiencyCheckFeB.status, "WARNING");
  assert.equal(boundary.overall.status, "COMPLIANT");
  assert.equal(calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-21", ascensionHistoryComplete: true }).overall.status, "ACTION_REQUIRED");
});

test("un événement sans FI/FE et les données incomplètes restent UNKNOWN", () => {
  const result = calculateBplMaintenance({ profile, events: [event("TRAINING_FLIGHT_BPL", "2026-01-01")], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
});

test("LEGACY_FLIGHT_TEST_DUE_DATE ne satisfait aucune voie BPL", () => {
  const legacy = event("LEGACY_FLIGHT_TEST_DUE_DATE", "2027-01-01");
  const result = calculateBplMaintenance({ profile, events: [legacy], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
});

test("les mois calendaires conservent correctement les fins de mois", () => {
  assert.equal(addCalendarMonths("2024-02-29", 24), "2026-02-28");
  assert.equal(addCalendarMonths("2026-08-31", -24), "2024-08-31");
});
