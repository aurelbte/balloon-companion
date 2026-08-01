import test from "node:test";
import assert from "node:assert/strict";
import {
  loadAscensionDemoState,
  saveAscensionDemoState,
} from "./ascensionDemoStorage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("un titre personnel ne modifie pas les données officielles", () => {
  globalThis.window = { localStorage: memoryStorage() };
  assert.equal(
    saveAscensionDemoState({
      version: 1,
      deletedIds: ["a"],
      customTitles: { b: "  Vol anniversaire  " },
    }),
    true,
  );
  assert.deepEqual(loadAscensionDemoState(["a", "b"]), {
    version: 1,
    deletedIds: ["a"],
    customTitles: { b: "Vol anniversaire" },
  });
  delete globalThis.window;
});
