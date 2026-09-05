import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultOfficialAscensionInput, officialAscensionFlightNature, officialAscensionMovementCounts } from "./flightCompletion.ts";
import { qualificationEventsAfterAscensionRemoval, qualificationEventTypeForFlightNature, reconcileQualificationEventForAscension } from "./officialAscensionQualifications.ts";

let sequence = 300;
const options = {
  uuid: () => `123e4567-e89b-42d3-a456-${String(++sequence).padStart(12, "0")}`,
  now: () => new Date("2026-08-20T10:00:00Z"),
};

function ascension(overrides = {}) {
  return { ...defaultOfficialAscensionInput(), id: "ascension-one", sourceFlightId: null, source: "MANUAL", gpsDurationMinutes: null, ...overrides };
}

test("une ascension legacy reste STANDARD à la lecture sans réécriture", () => {
  const legacy = ascension();
  assert.equal("flightNature" in legacy, false);
  assert.equal(officialAscensionFlightNature(legacy), "STANDARD");
});

test("les mouvements legacy utilisent 1/1 et les compteurs explicites supportent plusieurs mouvements", () => {
  assert.deepEqual(officialAscensionMovementCounts(ascension()), { takeoffs: 1, landings: 1, legacyFallback: true });
  assert.deepEqual(officialAscensionMovementCounts(ascension({ takeoffCount: 4, landingCount: 5 })), { takeoffs: 4, landings: 5, legacyFallback: false });
});

test("les natures mappées conservent leurs types réglementaires exacts", () => {
  assert.equal(qualificationEventTypeForFlightNature("TRAINING_BPL"), "TRAINING_FLIGHT_BPL");
  assert.equal(qualificationEventTypeForFlightNature("PROFICIENCY_CHECK_BPL"), "PROFICIENCY_CHECK_BPL");
  assert.equal(qualificationEventTypeForFlightNature("SKILL_TEST"), "SKILL_TEST_BPL");
  assert.equal(qualificationEventTypeForFlightNature("COMMERCIAL_PROFICIENCY_CHECK"), "COMMERCIAL_PROFICIENCY_CHECK");
  assert.equal(qualificationEventTypeForFlightNature("COMMERCIAL_TRAINING"), null);
  assert.equal(qualificationEventTypeForFlightNature("INSTRUCTION"), null);
  assert.equal(qualificationEventTypeForFlightNature("CAPTIVE"), null);
});

test("FI(B) ou FE(B) manquant interdit la création de l’événement", () => {
  assert.equal(reconcileQualificationEventForAscension(ascension({ flightNature: "TRAINING_BPL" }), [], options).status, "MISSING_FI");
  assert.equal(reconcileQualificationEventForAscension(ascension({ flightNature: "PROFICIENCY_CHECK_BPL" }), [], options).status, "MISSING_FE");
  assert.equal(reconcileQualificationEventForAscension(ascension({ flightNature: "SKILL_TEST" }), [], options).events.length, 0);
});

test("une ascension spéciale crée un seul événement lié sans duplication", () => {
  const source = ascension({ flightNature: "TRAINING_BPL", instructor: { name: "FI Test", licenceNumber: "FI-1" } });
  const first = reconcileQualificationEventForAscension(source, [], options);
  assert.equal(first.status, "CREATED");
  assert.equal(first.events[0].officialAscensionId, source.id);
  assert.equal(first.events[0].type, "TRAINING_FLIGHT_BPL");
  const second = reconcileQualificationEventForAscension(source, first.events, options);
  assert.equal(second.status, "UNCHANGED");
  assert.equal(second.events.length, 1);
});

test("l’édition met à jour le même événement et préserve son identité", () => {
  const initial = ascension({ flightNature: "TRAINING_BPL", instructor: { name: "FI Initial" } });
  const created = reconcileQualificationEventForAscension(initial, [], options);
  const id = created.events[0].id;
  const edited = reconcileQualificationEventForAscension({ ...initial, dateIso: "2026-08-21", instructor: { name: "FI Corrigé" } }, created.events, { ...options, now: () => new Date("2026-08-21T10:00:00Z") });
  assert.equal(edited.status, "UPDATED");
  assert.equal(edited.events.length, 1);
  assert.equal(edited.events[0].id, id);
  assert.equal(edited.events[0].dateIso, "2026-08-21");
  assert.equal(edited.events[0].instructor.name, "FI Corrigé");
});

test("la reconciliation préserve un snapshot groupId existant et n'en invente aucun", () => {
  const source = ascension({ flightNature: "TRAINING_BPL", instructor: { name: "FI Test" } });
  const created = reconcileQualificationEventForAscension(source, [], options);
  assert.equal(created.events[0].balloonClass.groupId, undefined);
  const withGroup = { ...created.events[0], balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "C" } };
  const updated = reconcileQualificationEventForAscension({ ...source, observations: "mise à jour" }, [withGroup], options);
  assert.equal(updated.events[0].balloonClass.groupId, "C");
});

test("passer à une nature non mappée conserve explicitement l’événement existant", () => {
  const special = ascension({ flightNature: "TRAINING_BPL", instructor: { name: "FI Test" } });
  const created = reconcileQualificationEventForAscension(special, [], options);
  const result = reconcileQualificationEventForAscension({ ...special, flightNature: "STANDARD", instructor: undefined }, created.events, options);
  assert.equal(result.status, "LINKED_EVENT_RETAINED");
  assert.deepEqual(result.events, created.events);
});

test("supprimer l’ascension conserve et signale l’événement lié", () => {
  const source = ascension({ flightNature: "COMMERCIAL_PROFICIENCY_CHECK", examiner: { name: "FE Test" } });
  const created = reconcileQualificationEventForAscension(source, [], options);
  const deletion = qualificationEventsAfterAscensionRemoval(source.id, created.events, () => new Date("2026-08-22T10:00:00Z"));
  assert.equal(deletion.events[0].id, created.events[0].id);
  assert.equal(deletion.events[0].officialAscensionId, source.id);
  assert.equal(deletion.events[0].officialAscensionDeletedAt, "2026-08-22T10:00:00.000Z");
  assert.deepEqual(deletion.retainedEventIds, [created.events[0].id]);
});

test("le formulaire expose la nature et conditionne les identités FI/FE", () => {
  const source = readFileSync(new URL("../components/journal/OfficialAscensionForm.tsx", import.meta.url), "utf8");
  assert.match(source, /Nature du vol/);
  assert.match(source, /Vol d’entraînement BPL/);
  assert.match(source, /Contrôle de compétences BPL/);
  assert.match(source, /Examen pratique/);
  assert.match(source, /<option value="CAPTIVE">Vol captif<\/option>/);
  assert.doesNotMatch(source, /values\.flightNature !== "STANDARD" && [^\n]*Décollages/);
  assert.match(source, /flightNatureRequiresInstructor/);
  assert.match(source, /flightNatureRequiresExaminer/);
});
