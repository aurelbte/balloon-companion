import test from "node:test";
import assert from "node:assert/strict";
import {
  loadJournalDemoState,
  saveJournalDemoState,
} from "./journalDemoStorage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("persiste suppressions et noms personnalisés dans une source unique", () => {
  globalThis.window = { localStorage: memoryStorage() };
  const state = {
    version: 2,
    deletedFlightIds: ["a"],
    customNames: { b: "  Vol du matin  " },
  };
  assert.equal(saveJournalDemoState(state), true);
  assert.deepEqual(loadJournalDemoState(["a", "b", "c"]), {
    version: 2,
    deletedFlightIds: ["a"],
    customNames: { b: "Vol du matin" },
  });
  delete globalThis.window;
});

test("migre l’ancien tableau de suppressions et ignore les identifiants inconnus", () => {
  const localStorage = memoryStorage();
  globalThis.window = { localStorage };
  localStorage.setItem(
    "balloon-companion-journal-demo-deleted-v1",
    JSON.stringify(["known", "known", "obsolete", 42]),
  );
  assert.deepEqual(loadJournalDemoState(["known"]), {
    version: 2,
    deletedFlightIds: ["known"],
    customNames: {},
  });
  delete globalThis.window;
});
