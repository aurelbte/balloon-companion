import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { emptyBplEventDraft, linkBplEventToAscension, updateLinkedBplEventProof, upsertHistoricalBplEvent, upsertInitialBplIssuance } from "./bplQualificationEventForm.ts";
import { defaultOfficialAscensionInput } from "./flightCompletion.ts";
import { createEmptyQualificationProfile } from "./pilotQualifications.ts";
import { loadPilotQualifications, savePilotQualifications } from "./pilotQualificationsStorage.ts";

const options = { uuid: () => "123e4567-e89b-42d3-a456-426614174201", now: () => new Date("2026-08-20T10:00:00Z") };
function ascension(flightNature) { return { ...defaultOfficialAscensionInput(), id: `asc-${flightNature}`, sourceFlightId: null, source: "MANUAL", gpsDurationMinutes: null, flightNature, dateIso: "2026-06-12" }; }
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test("associer une ascension d’entraînement réutilise le mapping et ne duplique pas", () => {
  const source = ascension("TRAINING_BPL");
  const draft = { ...emptyBplEventDraft(), personName: "Jean Dupont", notes: "Preuve FI", groupId: "B" };
  const first = linkBplEventToAscension([], "TRAINING_FLIGHT_BPL", source, draft, options);
  assert.equal(first.ok, true);
  assert.equal(first.event.type, "TRAINING_FLIGHT_BPL");
  assert.equal(first.event.officialAscensionId, source.id);
  assert.equal(first.event.instructor.name, "Jean Dupont");
  assert.equal(first.event.balloonClass.groupId, "B");
  const second = linkBplEventToAscension(first.events, "TRAINING_FLIGHT_BPL", source, draft, options);
  assert.equal(second.ok, true);
  assert.equal(second.events.length, 1);
  assert.equal(second.event.id, first.event.id);
});

test("FI(B) et FE(B) sont obligatoires selon le type", () => {
  assert.match(linkBplEventToAscension([], "TRAINING_FLIGHT_BPL", ascension("TRAINING_BPL"), { ...emptyBplEventDraft(), groupId: "A" }).error, /FI\(B\)/);
  assert.match(linkBplEventToAscension([], "PROFICIENCY_CHECK_BPL", ascension("PROFICIENCY_CHECK_BPL"), { ...emptyBplEventDraft(), groupId: "A" }).error, /FE\(B\)/);
});

test("associer un contrôle crée la preuve FE(B) correspondante", () => {
  const result = linkBplEventToAscension([], "PROFICIENCY_CHECK_BPL", ascension("PROFICIENCY_CHECK_BPL"), { ...emptyBplEventDraft(), personName: "Anne Martin", groupId: "C" }, options);
  assert.equal(result.ok, true);
  assert.equal(result.event.type, "PROFICIENCY_CHECK_BPL");
  assert.equal(result.event.examiner.name, "Anne Martin");
  assert.equal(result.event.officialAscensionId, "asc-PROFICIENCY_CHECK_BPL");
  assert.equal(result.event.balloonClass.groupId, "C");
});

test("les événements historiques ne créent ni ascension ni lien carnet", () => {
  const training = upsertHistoricalBplEvent([], "TRAINING_FLIGHT_BPL", { dateIso: "2025-06-12", personName: "FI Historique", notes: "", classId: "HOT_AIR_BALLOON", groupId: "B" }, undefined, options);
  assert.equal(training.ok, true);
  assert.equal(training.event.officialAscensionId, undefined);
  const check = upsertHistoricalBplEvent(training.events, "PROFICIENCY_CHECK_BPL", { dateIso: "2025-07-01", personName: "FE Historique", notes: "", classId: "GAS_BALLOON", groupId: "" }, undefined, { ...options, uuid: () => "123e4567-e89b-42d3-a456-426614174202" });
  assert.equal(check.ok, true);
  assert.equal(check.event.examiner.name, "FE Historique");
  assert.equal(check.events.length, 2);
});

test("modifier une preuve liée conserve UUID, lien, date du vol et marqueur de suppression", () => {
  const linked = linkBplEventToAscension([], "TRAINING_FLIGHT_BPL", ascension("TRAINING_BPL"), { ...emptyBplEventDraft(), personName: "FI Initial", groupId: "D" }, options);
  assert.equal(linked.ok, true);
  const retained = { ...linked.event, officialAscensionDeletedAt: "2026-08-21T10:00:00.000Z" };
  const edited = updateLinkedBplEventProof([retained], "TRAINING_FLIGHT_BPL", { ...emptyBplEventDraft(retained), personName: "FI Corrigé", notes: "Correction" }, retained.id, () => new Date("2026-08-22T10:00:00Z"));
  assert.equal(edited.ok, true);
  assert.equal(edited.events.length, 1);
  assert.equal(edited.event.id, retained.id);
  assert.equal(edited.event.dateIso, retained.dateIso);
  assert.equal(edited.event.officialAscensionId, retained.officialAscensionId);
  assert.equal(edited.event.officialAscensionDeletedAt, retained.officialAscensionDeletedAt);
});

test("GUEST conserve et modifie un événement historique après rechargement", () => {
  const local = storage();
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  const created = upsertHistoricalBplEvent([], "PROFICIENCY_CHECK_BPL", { dateIso: "2025-07-01", personName: "FE Un", notes: "", classId: "HOT_AIR_BALLOON", groupId: "A" }, undefined, options);
  assert.equal(created.ok, true);
  const profile = { ...createEmptyQualificationProfile(), configured: true, licenceType: "BPL" };
  assert.equal(savePilotQualifications({ profile, events: created.events }, local), true);
  const reloaded = loadPilotQualifications(local);
  const edited = upsertHistoricalBplEvent(reloaded.events, "PROFICIENCY_CHECK_BPL", { dateIso: "2025-07-02", personName: "FE Deux", notes: "", classId: "HOT_AIR_BALLOON", groupId: "A" }, created.event.id, { now: () => new Date("2026-08-22T10:00:00Z") });
  assert.equal(edited.ok, true);
  assert.equal(edited.events.length, 1);
  assert.equal(savePilotQualifications({ profile, events: edited.events }, local), true);
  assert.equal(loadPilotQualifications(local).events[0].examiner.name, "FE Deux");
});

test("USER conserve localement une preuve BPL", () => {
  const local = storage();
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "phase-7b", email: "pilot@example.com", firstName: "", lastName: "" } });
  const created = upsertHistoricalBplEvent([], "TRAINING_FLIGHT_BPL", { dateIso: "2025-06-12", personName: "FI Local", notes: "", classId: "HOT_AIR_BALLOON", groupId: "C" }, undefined, options);
  assert.equal(created.ok, true);
  const profile = { ...createEmptyQualificationProfile(), configured: true, licenceType: "BPL" };
  assert.equal(savePilotQualifications({ profile, events: created.events }, local), true);
  assert.equal(loadPilotQualifications(local).events[0].instructor.name, "FI Local");
});

test("la délivrance initiale reste distincte d’un vol d’entraînement", () => {
  const result = upsertInitialBplIssuance([], { dateIso: "2023-04-30", notes: "Délivrance" }, undefined, options);
  assert.equal(result.ok, true);
  assert.equal(result.event.type, "INITIAL_BPL_ISSUANCE");
  assert.equal(result.event.instructor, undefined);
  assert.equal(result.event.examiner, undefined);
});
