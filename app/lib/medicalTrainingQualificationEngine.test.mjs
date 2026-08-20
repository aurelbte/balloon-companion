import assert from "node:assert/strict";
import test from "node:test";
import { calculateMedicalQualification, calculateProfessionalTrainingStatus } from "./medicalTrainingQualificationEngine.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";

const commercialProfile = { licenceType: "BPL", commercialOperationsEnabled: true, fiBEnabled: false, feBEnabled: false };
let sequence = 200;

function event(type, dateIso, details = {}) {
  sequence += 1;
  return createQualificationEvent({ type, dateIso, source: "MANUAL", ...details }, { uuid: () => `123e4567-e89b-42d3-a456-${String(sequence).padStart(12, "0")}`, now: () => new Date("2026-08-20T00:00:00Z") });
}

function medical(events, requiredClass = "LAPL", legacyDate = null) {
  return calculateMedicalQualification({ events, legacy: { medicalDueDateIso: legacyDate }, referenceDateIso: "2026-08-20", requiredClass });
}

test("un médical LAPL valide satisfait l’exigence BPL standard", () => {
  const source = event("MEDICAL", "2026-01-10", { expiryDateIso: "2027-08-20", medicalClass: "LAPL", notes: "Visite" });
  const result = medical([source]);
  assert.equal(result.expiry.status, "COMPLIANT");
  assert.equal(result.level.status, "COMPLIANT");
  assert.equal(result.overall.status, "COMPLIANT");
  assert.deepEqual(result.overall.sourceEventIds, [source.id]);
});

test("un médical expiré exige une action", () => {
  const source = event("MEDICAL", "2024-01-10", { expiryDateIso: "2026-08-19", medicalClass: "LAPL" });
  assert.equal(medical([source]).overall.status, "ACTION_REQUIRED");
});

test("CLASS_2 satisfait LAPL mais LAPL ne satisfait pas CLASS_2", () => {
  const class2 = event("MEDICAL", "2026-01-10", { expiryDateIso: "2027-08-20", medicalClass: "CLASS_2" });
  assert.equal(medical([class2], "LAPL").overall.status, "COMPLIANT");
  const lapl = event("MEDICAL", "2026-01-10", { expiryDateIso: "2027-08-20", medicalClass: "LAPL" });
  const commercial = medical([lapl], "CLASS_2");
  assert.equal(commercial.level.status, "ACTION_REQUIRED");
  assert.equal(commercial.overall.status, "ACTION_REQUIRED");
});

test("le legacy donne un statut de date mais jamais un niveau médical", () => {
  const result = medical([], "LAPL", "2027-08-20");
  assert.equal(result.expiry.status, "COMPLIANT");
  assert.equal(result.level.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
  assert.deepEqual(result.expiry.sourceEventIds, undefined);
});

test("un événement médical sans échéance reste UNKNOWN", () => {
  const source = event("MEDICAL", "2026-01-10", { medicalClass: "LAPL" });
  assert.equal(medical([source]).expiry.status, "UNKNOWN");
  assert.equal(medical([source]).overall.status, "UNKNOWN");
});

test("PSC1 avec échéance utilise la date explicite", () => {
  const source = event("FIRST_AID", "2026-01-01", { expiryDateIso: "2026-10-01", organization: "Protection civile" });
  const result = calculateProfessionalTrainingStatus({ profile: commercialProfile, events: [source], type: "FIRST_AID", referenceDateIso: "2026-08-20" });
  assert.equal(source.organization, "Protection civile");
  assert.equal(result.status, "WARNING");
  assert.equal(result.dueDate, "2026-10-01");
});

test("PSC1 sans échéance reste historisé mais UNKNOWN", () => {
  const source = event("FIRST_AID", "2026-01-01", { organization: "Protection civile" });
  assert.equal(calculateProfessionalTrainingStatus({ profile: commercialProfile, events: [source], type: "FIRST_AID", referenceDateIso: "2026-08-20" }).status, "UNKNOWN");
});

test("formation incendie avec et sans échéance", () => {
  const valid = event("FIRE_TRAINING", "2026-01-01", { expiryDateIso: "2027-08-20" });
  assert.equal(calculateProfessionalTrainingStatus({ profile: commercialProfile, events: [valid], type: "FIRE_TRAINING", referenceDateIso: "2026-08-20" }).status, "COMPLIANT");
  const undated = event("FIRE_TRAINING", "2026-02-01");
  assert.equal(calculateProfessionalTrainingStatus({ profile: commercialProfile, events: [undated], type: "FIRE_TRAINING", referenceDateIso: "2026-08-20" }).status, "UNKNOWN");
});

test("OTHER_TRAINING suit la même règle sans durée codée en dur", () => {
  const source = event("OTHER_TRAINING", "2026-01-01", { expiryDateIso: "2026-08-19", organization: "Organisme pro" });
  assert.equal(calculateProfessionalTrainingStatus({ profile: commercialProfile, events: [source], type: "OTHER_TRAINING", referenceDateIso: "2026-08-20" }).status, "ACTION_REQUIRED");
});

test("commercial désactivé est NON_APPLICABLE sauf suivi volontaire", () => {
  const profile = { ...commercialProfile, commercialOperationsEnabled: false };
  const source = event("FIRST_AID", "2026-01-01", { expiryDateIso: "2027-08-20" });
  assert.equal(calculateProfessionalTrainingStatus({ profile, events: [source], type: "FIRST_AID", referenceDateIso: "2026-08-20" }).status, "NON_APPLICABLE");
  assert.equal(calculateProfessionalTrainingStatus({ profile, events: [source], type: "FIRST_AID", referenceDateIso: "2026-08-20", trackWhenCommercialDisabled: true }).status, "COMPLIANT");
});
