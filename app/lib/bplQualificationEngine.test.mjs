import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarMonths, calculateBplMaintenance, calculateDatedExperience } from "./bplQualificationEngine.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";
import { removeQualificationEvent } from "./qualificationEventForm.ts";

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

test("une fenêtre BPL partiellement couverte reste UNKNOWN sans proposer FE(B)", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [ascension("known", "2026-01-01", 60)], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, historyCoverageStartDate: "2025-01-01" });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
  assert.match(result.recentExperience.reason, /Historique récent à compléter/);
});

test("une fenêtre BPL explicitement complète peut conclure ACTION_REQUIRED", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2024-08-20" });
  assert.equal(result.recentExperience.status, "ACTION_REQUIRED");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("une déclaration BPL applicable sert de pont puis est ignorée avec un historique complet", () => {
  const declaredProfile = { ...profile, declaredBplInitialSituation: { referenceDateIso: "2026-08-01", recentExperienceSatisfied: true } };
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { instructor: { name: "FI Test" } });
  const partial = calculateBplMaintenance({ profile: declaredProfile, events: [training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2025-01-01" });
  assert.equal(partial.recentExperience.status, "COMPLIANT");
  assert.equal(partial.recentExperience.provenance, "DECLARED_BY_PILOT");
  assert.equal(partial.recentExperience.currentValue.officialDurationMinutes, 0);
  assert.equal(partial.overall.provenance, "DECLARED_BY_PILOT");
  const complete = calculateBplMaintenance({ profile: declaredProfile, events: [training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2024-08-20" });
  assert.equal(complete.recentExperience.status, "ACTION_REQUIRED");
  assert.equal(complete.recentExperience.provenance, undefined);
});

test("une déclaration BPL périmée ne remplace pas un historique incomplet", () => {
  const declaredProfile = { ...profile, declaredBplInitialSituation: { referenceDateIso: "2024-08-19", recentExperienceSatisfied: true } };
  const result = calculateBplMaintenance({ profile: declaredProfile, events: [], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
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

test("la voie normale satisfaite ne rend pas le contrôle FE(B) obligatoire", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { instructor: { name: "FI Test" } });
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const result = calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
  assert.match(result.proficiencyCheckFeB.reason, /alternative non nécessaire/);
});

test("la délivrance est la référence initiale puis un entraînement ultérieur la remplace", () => {
  const issuance = event("INITIAL_BPL_ISSUANCE", "2023-04-30");
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const initial = calculateBplMaintenance({ profile, events: [issuance], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(initial.trainingFlightFiB.currentValue, "2023-04-30");
  assert.equal(initial.trainingFlightFiB.dueDate, "2027-04-30");
  assert.deepEqual(initial.trainingFlightFiB.sourceEventIds, [issuance.id]);
  const training = event("TRAINING_FLIGHT_BPL", "2025-06-01", { instructor: { name: "FI Test" } });
  const updated = calculateBplMaintenance({ profile, events: [issuance, training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(updated.trainingFlightFiB.currentValue, "2025-06-01");
  assert.deepEqual(updated.trainingFlightFiB.sourceEventIds, [training.id]);
});

test("la voie FE(B) alternative suit exactement 24 mois", () => {
  const check = event("PROFICIENCY_CHECK_BPL", "2024-08-20", { examiner: { name: "FE Test" } });
  const boundary = calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(boundary.proficiencyCheckFeB.status, "WARNING");
  assert.equal(boundary.overall.status, "COMPLIANT");
  assert.equal(calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-21", ascensionHistoryComplete: true }).overall.status, "ACTION_REQUIRED");
});

test("supprimer le contrôle alternatif recalcule le moteur sans toucher aux ascensions", () => {
  const check = event("PROFICIENCY_CHECK_BPL", "2026-01-01", { examiner: { name: "FE Test" } });
  const ascensions = [ascension("source", "2023-01-01", 60)];
  const before = structuredClone(ascensions);
  assert.equal(calculateBplMaintenance({ profile, events: [check], ascensions, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true }).overall.status, "COMPLIANT");
  const events = removeQualificationEvent([check], check.id);
  assert.equal(events.length, 0);
  assert.equal(calculateBplMaintenance({ profile, events, ascensions, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true }).overall.status, "ACTION_REQUIRED");
  assert.deepEqual(ascensions, before);
});

test("un événement sans FI/FE et les données incomplètes restent UNKNOWN", () => {
  const result = calculateBplMaintenance({ profile, events: [event("TRAINING_FLIGHT_BPL", "2026-01-01")], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
});

test("LEGACY_FLIGHT_TEST_DUE_DATE ne satisfait aucune voie BPL", () => {
  const legacy = event("LEGACY_FLIGHT_TEST_DUE_DATE", "2027-01-01");
  const result = calculateBplMaintenance({ profile, events: [legacy], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "UNKNOWN");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("les mois calendaires conservent correctement les fins de mois", () => {
  assert.equal(addCalendarMonths("2024-02-29", 24), "2026-02-28");
  assert.equal(addCalendarMonths("2026-08-31", -24), "2024-08-31");
});
