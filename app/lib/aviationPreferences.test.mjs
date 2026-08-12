import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import { loadAviationPreferences, saveAviationPreferences } from "./aviation/aviationPreferencesStorage.ts";

function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test("persiste un ICAO Aviation indépendamment du favori météo", () => {
  globalThis.window = { localStorage: storage() };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "A", email: "a@example.com", firstName: "", lastName: "" } });
  assert.equal(loadAviationPreferences(), null);
  assert.deepEqual(saveAviationPreferences(" lfqq "), { airportIcao: "LFQQ", initialized: true });
  assert.equal(loadAviationPreferences().airportIcao, "LFQQ");
  delete globalThis.window;
});

test("une préférence initialisée sans aérodrome reste distincte d'une absence de préférence", () => {
  globalThis.window = { localStorage: storage() };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "B", email: "b@example.com", firstName: "", lastName: "" } });
  saveAviationPreferences(null);
  assert.deepEqual(loadAviationPreferences(), { airportIcao: null, initialized: true });
  delete globalThis.window;
});
