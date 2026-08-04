import test from "node:test";
import assert from "node:assert/strict";
import {
  FLIGHT_COMPLETION_STORAGE_KEY,
  loadFlightCompletionState,
  persistPilotExperience,
} from "./flightCompletionStorage.ts";

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
