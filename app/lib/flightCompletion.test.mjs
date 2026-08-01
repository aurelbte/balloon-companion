import test from "node:test";
import assert from "node:assert/strict";
import {
  addManualOfficialAscension,
  calculatePilotOfficialTotals,
  confirmPilotExperience,
  createEmptyFlightCompletionState,
  createUnconfiguredFlightCompletionState,
  defaultOfficialAscensionInput,
  DEMO_COMPLETION_FLIGHT_ID,
  ensureCompletionJournalFlight,
  removeOfficialAscension,
  validateOfficialAscension,
} from "./flightCompletion.ts";

const manualInput = {
  ...defaultOfficialAscensionInput(),
  dateIso: "2026-08-02",
  date: "2 août 2026",
  officialDurationMinutes: 45,
};

test("nouveau pilote : zéro confirmé reste distinct d’une expérience inconnue", () => {
  const configured = confirmPilotExperience(createUnconfiguredFlightCompletionState(), {
    hours: 0, minutes: 0, ascensions: 0,
  });
  assert.equal(configured.openingBalance.confirmed, true);
  assert.equal(calculatePilotOfficialTotals(configured).officialDurationMinutes, 0);
  const withManual = addManualOfficialAscension(configured, "manual-zero", manualInput);
  assert.equal(calculatePilotOfficialTotals(withManual).officialDurationMinutes, 45);
  assert.equal(calculatePilotOfficialTotals(withManual).ascensions, 1);
});

test("une expérience inconnue produit des totaux neutres", () => {
  const totals = calculatePilotOfficialTotals(createUnconfiguredFlightCompletionState());
  assert.equal(totals.displayHours, null);
  assert.equal(totals.ascensions, null);
});

test("ajout manuel : aucune trace ni entrée Journal n’est inventée", () => {
  const state = addManualOfficialAscension(
    createEmptyFlightCompletionState(), "manual-one", { ...manualInput, officialDurationMinutes: 60 },
  );
  assert.equal(state.journalFlights.length, 0);
  assert.equal(state.officialAscensions[0].source, "MANUAL");
  assert.equal(state.officialAscensions[0].sourceFlightId, null);
  assert.equal(state.officialAscensions[0].gpsDurationMinutes, null);
  assert.equal(calculatePilotOfficialTotals(state).officialDurationMinutes, 8_255);
});

test("modifier le solde initial conserve les ascensions manuelles et recalcule le total", () => {
  const withManual = addManualOfficialAscension(
    createEmptyFlightCompletionState(), "manual-kept", { ...manualInput, officialDurationMinutes: 60 },
  );
  const manualBefore = structuredClone(withManual.officialAscensions[0]);
  const modified = confirmPilotExperience(withManual, {
    hours: 140, minutes: 0, ascensions: 110,
  });
  assert.deepEqual(modified.officialAscensions[0], manualBefore);
  assert.equal(calculatePilotOfficialTotals(modified).officialDurationMinutes, 8_460);
  assert.equal(calculatePilotOfficialTotals(modified).ascensions, 111);
});

test("les valeurs invalides ne modifient pas l’expérience antérieure", () => {
  const unknown = createUnconfiguredFlightCompletionState();
  assert.equal(confirmPilotExperience(unknown, { hours: 1, minutes: 60, ascensions: 1 }), unknown);
  assert.equal(confirmPilotExperience(unknown, { hours: -1, minutes: 0, ascensions: 1 }), unknown);
});

test("Journal automatique : la création est idempotente", () => {
  const once = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  const twice = ensureCompletionJournalFlight(once);
  assert.equal(once.journalFlights.length, 1);
  assert.equal(twice.journalFlights.length, 1);
  assert.equal(twice.journalFlights[0].id, DEMO_COMPLETION_FLIGHT_ID);
});

test("Plus tard : conserve le Journal en attente sans modifier le total officiel", () => {
  const state = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  assert.equal(state.journalFlights[0].logbookStatus, "PENDING");
  assert.equal(state.officialAscensions.length, 0);
  assert.deepEqual(calculatePilotOfficialTotals(state), {
    ascensions: 108,
    officialDurationMinutes: 8_195,
    totalHoursExact: 8_195 / 60,
    displayHours: 136,
    remainingMinutes: 35,
  });
});

test("Validation à 57 minutes : produit exactement 109 ascensions et 137 h 32", () => {
  const state = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    defaultOfficialAscensionInput(),
  );
  const totals = calculatePilotOfficialTotals(state);
  assert.equal(totals.ascensions, 109);
  assert.equal(totals.displayHours, 137);
  assert.equal(totals.remainingMinutes, 32);
});

test("Validation à 60 minutes : ne modifie jamais les 57 minutes GPS", () => {
  const state = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  assert.equal(state.journalFlights[0].durationMinutes, 57);
  assert.equal(state.officialAscensions[0].officialDurationMinutes, 60);
  assert.equal(calculatePilotOfficialTotals(state).officialDurationMinutes, 8_255);
});

test("une double validation met à jour l’ascension sans créer de doublon", () => {
  const first = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    defaultOfficialAscensionInput(),
  );
  const second = validateOfficialAscension(
    first,
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  assert.equal(second.officialAscensions.length, 1);
});

test("modifier la durée officielle recalcule toujours le total", () => {
  const initial = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  const modified = validateOfficialAscension(
    initial,
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 50 },
  );
  assert.equal(calculatePilotOfficialTotals(modified).officialDurationMinutes, 8_245);
});

test("supprimer une ascension recalcule le total et remet le Journal en attente", () => {
  const validated = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  const removed = removeOfficialAscension(validated, validated.officialAscensions[0].id);
  assert.equal(calculatePilotOfficialTotals(removed).ascensions, 108);
  assert.equal(removed.journalFlights[0].logbookStatus, "PENDING");
});

test("une ascension manuelle accepte une altitude absente et conserve le temps en minutes", () => {
  const state = addManualOfficialAscension(
    createEmptyFlightCompletionState(),
    "manual-no-altitude",
    { ...manualInput, maximumAltitudeM: null, nightFlight: false, officialDurationMinutes: 75 },
  );
  assert.equal(state.officialAscensions[0].maximumAltitudeM, null);
  assert.equal(state.officialAscensions[0].nightFlight, false);
  assert.equal(state.officialAscensions[0].officialDurationMinutes, 75);
});
