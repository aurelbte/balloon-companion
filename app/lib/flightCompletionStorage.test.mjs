import test from "node:test";
import assert from "node:assert/strict";
import {
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
