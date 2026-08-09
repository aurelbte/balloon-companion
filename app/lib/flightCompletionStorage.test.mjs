import test from "node:test";
import assert from "node:assert/strict";
import {
  FLIGHT_COMPLETION_STORAGE_KEY,
  loadFlightCompletionState,
  ensureDemoCompletionPersisted,
  persistOfficialAscension,
  persistOfficialAscensionUpdate,
  persistPilotExperience,
  saveFlightCompletionState,
} from "./flightCompletionStorage.ts";
import { calculatePilotOfficialTotals, createEmptyFlightCompletionState, defaultOfficialAscensionInput, DEMO_COMPLETION_FLIGHT_ID, ensureCompletionJournalFlight, validateOfficialAscension } from "./flightCompletion.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("l’expérience confirmée survit au rechargement du stockage", () => {
  globalThis.window = {
    localStorage: memoryStorage(),
    dispatchEvent: () => true,
  };
  persistPilotExperience({ hours: 140, minutes: 0, ascensions: 110 });
  const restored = loadFlightCompletionState();
  assert.equal(restored.openingBalance.confirmed, true);
  assert.equal(restored.openingBalance.officialDurationMinutes, 8_400);
  assert.equal(restored.openingBalance.ascensions, 110);
  delete globalThis.window;
});

test("la durée officielle ajustée est persistée indépendamment de la durée GPS", () => {
  globalThis.window = {
    localStorage: memoryStorage(),
    dispatchEvent: () => true,
  };
  ensureDemoCompletionPersisted();
  persistOfficialAscension(DEMO_COMPLETION_FLIGHT_ID, {
    ...defaultOfficialAscensionInput(),
    officialDurationMinutes: 70,
  });
  const restored = loadFlightCompletionState();
  assert.equal(restored.journalFlights[0].durationMinutes, 57);
  assert.equal(restored.officialAscensions[0].officialDurationMinutes, 70);
  delete globalThis.window;
});

test("la taille du Journal localStorage reste indépendante du nombre de points GPS", () => {
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage, dispatchEvent: () => true };
  const state = ensureDemoCompletionPersisted();
  const baseline = JSON.stringify(state);
  const manyPoints = Array.from({ length: 5_000 }, (_, index) => ({
    longitude: 3 + index / 100_000,
    latitude: 50 + index / 100_000,
    elapsedMinutes: index / 6,
    altitudeM: 100 + index,
    speedKmh: 20,
  }));
  saveFlightCompletionState({
    ...state,
    journalFlights: state.journalFlights.map((flight) => ({ ...flight, points: manyPoints })),
  });
  const persisted = storage.getItem(FLIGHT_COMPLETION_STORAGE_KEY);
  assert.deepEqual(JSON.parse(persisted).journalFlights[0].points, []);
  assert.ok(persisted.length <= baseline.length + 100);
  delete globalThis.window;
});

test("EDIT met à jour A1 de 69 à 70 minutes sans duplication ni mutation du Journal GPS", () => {
  globalThis.window = {
    localStorage: memoryStorage(),
    dispatchEvent: () => true,
  };
  const pending = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  const sourceFlight = { ...pending.journalFlights[0], id: "J1" };
  const linked = validateOfficialAscension(
    { ...pending, journalFlights: [sourceFlight] },
    "J1",
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 69 },
  );
  const initial = {
    ...linked,
    officialAscensions: [{ ...linked.officialAscensions[0], id: "A1" }],
  };
  const journalBefore = structuredClone(initial.journalFlights[0]);
  const totalsBefore = calculatePilotOfficialTotals(initial);
  saveFlightCompletionState(initial);

  const updated = persistOfficialAscensionUpdate("A1", {
    ...defaultOfficialAscensionInput(),
    officialDurationMinutes: 70,
  });
  const restored = loadFlightCompletionState();
  const totalsAfter = calculatePilotOfficialTotals(restored);

  assert.equal(updated?.id, "A1");
  assert.equal(updated?.officialDurationMinutes, 70);
  assert.equal(updated?.sourceFlightId, "J1");
  assert.equal(restored.officialAscensions.length, 1);
  assert.equal(restored.officialAscensions[0].id, "A1");
  assert.equal(restored.journalFlights[0].id, journalBefore.id);
  assert.equal(restored.journalFlights[0].durationMinutes, journalBefore.durationMinutes);
  assert.equal(restored.journalFlights[0].distanceKm, journalBefore.distanceKm);
  assert.deepEqual(restored.journalFlights[0].points, []);
  assert.deepEqual(restored.journalFlights[0].statistics, journalBefore.statistics);
  assert.equal(totalsAfter.ascensions, totalsBefore.ascensions);
  assert.equal(totalsAfter.officialDurationMinutes, (totalsBefore.officialDurationMinutes ?? 0) + 1);
  delete globalThis.window;
});

test("la migration sépare le nom généré d'un ancien titre personnalisé", () => {
  globalThis.window = globalThis;
  globalThis.localStorage = memoryStorage();
  localStorage.setItem(FLIGHT_COMPLETION_STORAGE_KEY, JSON.stringify({
    version: 3,
    openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null },
    journalFlights: [{
      id: "real-1", title: "Vol du matin", departure: "LFQO", arrival: "Mérignies",
      takeoffTime: "06:45", logbookStatus: "PENDING",
    }],
    officialAscensions: [],
  }));
  const restored = loadFlightCompletionState();
  assert.equal(restored.journalFlights[0].generatedTitle, "LFQO → Mérignies");
  assert.equal(restored.journalFlights[0].customTitle, "Vol du matin");
  delete globalThis.window;
  delete globalThis.localStorage;
});

test("un ancien titre technique n'est pas pris pour un nom personnalisé", () => {
  globalThis.window = globalThis;
  globalThis.localStorage = memoryStorage();
  localStorage.setItem(FLIGHT_COMPLETION_STORAGE_KEY, JSON.stringify({
    version: 3,
    openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null },
    journalFlights: [{
      id: "real-2", title: "Vol du 4 août 2026", departure: "Départ inconnu", arrival: "Arrivée inconnue",
      takeoffTime: "19:33", logbookStatus: "PENDING",
    }],
    officialAscensions: [],
  }));
  const restored = loadFlightCompletionState();
  assert.equal(restored.journalFlights[0].generatedTitle, "Départ inconnu → Arrivée inconnue");
  assert.equal(restored.journalFlights[0].customTitle, undefined);
  delete globalThis.window;
  delete globalThis.localStorage;
});
