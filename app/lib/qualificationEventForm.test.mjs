import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { createEmptyQualificationProfile } from "./pilotQualifications.ts";
import { emptyQualificationEventDraft, upsertQualificationEvent } from "./qualificationEventForm.ts";
import { loadPilotQualifications, savePilotQualifications } from "./pilotQualificationsStorage.ts";
import { calculateMedicalQualification } from "./medicalTrainingQualificationEngine.ts";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

const ids = [
  "123e4567-e89b-42d3-a456-426614174101",
  "123e4567-e89b-42d3-a456-426614174102",
  "123e4567-e89b-42d3-a456-426614174103",
];
let idIndex = 0;
const options = () => ({ uuid: () => ids[idIndex++], now: () => new Date(`2026-08-2${idIndex}T10:00:00Z`) });

test("GUEST ajoute médical, PSC1 et incendie puis les retrouve hors ligne", () => {
  const storage = memoryStorage();
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  idIndex = 0;
  let events = [];
  for (const [type, draft] of [
    ["MEDICAL", { dateIso: "2026-08-01", expiryDateIso: "2027-08-01", medicalClass: "LAPL", organization: "", notes: "Visite" }],
    ["FIRST_AID", { dateIso: "2026-07-01", expiryDateIso: "", medicalClass: "", organization: "Croix-Rouge", notes: "" }],
    ["FIRE_TRAINING", { dateIso: "2026-06-01", expiryDateIso: "2027-06-01", medicalClass: "", organization: "Centre feu", notes: "" }],
  ]) {
    const result = upsertQualificationEvent(events, type, draft, undefined, options());
    assert.equal(result.ok, true);
    events = result.events;
  }
  const profile = { ...createEmptyQualificationProfile(), configured: true, licenceType: "BPL", commercialOperationsEnabled: true };
  assert.equal(savePilotQualifications({ profile, events }, storage), true);
  const reloaded = loadPilotQualifications(storage);
  assert.equal(reloaded.events.length, 3);
  assert.equal(reloaded.events.find(({ type }) => type === "FIRST_AID").expiryDateIso, undefined);
});

test("modifier un médical Classe 2 conserve son UUID sans duplication", () => {
  idIndex = 0;
  const created = upsertQualificationEvent([], "MEDICAL", { ...emptyQualificationEventDraft(), medicalClass: "LAPL", dateIso: "2026-01-01", expiryDateIso: "2027-01-01" }, undefined, options());
  assert.equal(created.ok, true);
  const modified = upsertQualificationEvent(created.events, "MEDICAL", { ...emptyQualificationEventDraft(), medicalClass: "CLASS_2", dateIso: "2026-02-01", expiryDateIso: "2028-02-01" }, created.event.id, { now: () => new Date("2026-08-22T10:00:00Z") });
  assert.equal(modified.ok, true);
  assert.equal(modified.events.length, 1);
  assert.equal(modified.event.id, created.event.id);
  assert.equal(modified.event.medicalClass, "CLASS_2");
  assert.equal(modified.event.createdAt, created.event.createdAt);
});

test("un nouvel événement médical complet devient prioritaire sans supprimer le legacy", () => {
  idIndex = 0;
  const added = upsertQualificationEvent([], "MEDICAL", { ...emptyQualificationEventDraft(), medicalClass: "LAPL", dateIso: "2026-01-01", expiryDateIso: "2028-01-01" }, undefined, options());
  assert.equal(added.ok, true);
  const legacy = { flightTestDueDateIso: null, medicalDueDateIso: "2026-09-01" };
  const result = calculateMedicalQualification({ events: added.events, legacy, referenceDateIso: "2026-08-20" });
  assert.equal(result.expiry.dueDate, "2028-01-01");
  assert.deepEqual(legacy, { flightTestDueDateIso: null, medicalDueDateIso: "2026-09-01" });
});

test("USER utilise le même stockage local et aucune validité de formation n’est inventée", () => {
  const storage = memoryStorage();
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "phase-7a", email: "pilot@example.com", firstName: "", lastName: "" } });
  idIndex = 1;
  const added = upsertQualificationEvent([], "FIRST_AID", { ...emptyQualificationEventDraft(), dateIso: "2026-07-01" }, undefined, options());
  assert.equal(added.ok, true);
  assert.equal(savePilotQualifications({ profile: { ...createEmptyQualificationProfile(), configured: true }, events: added.events }, storage), true);
  assert.equal(loadPilotQualifications(storage).events[0].expiryDateIso, undefined);
});

test("la validation refuse les champs médicaux manquants et une échéance antérieure", () => {
  assert.deepEqual(upsertQualificationEvent([], "MEDICAL", emptyQualificationEventDraft()), { ok: false, error: "Choisissez une classe médicale." });
  const invalid = upsertQualificationEvent([], "FIRE_TRAINING", { ...emptyQualificationEventDraft(), dateIso: "2026-08-02", expiryDateIso: "2026-08-01" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /échéance/i);
});
