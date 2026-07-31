import test from "node:test";
import assert from "node:assert/strict";
import {
  loadDeletedDemoFlightIds,
  persistDeletedDemoFlightIds,
} from "./journalDemoStorage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("persiste et déduplique les suppressions de démonstration", () => {
  globalThis.window = { localStorage: memoryStorage() };
  assert.equal(persistDeletedDemoFlightIds(["a", "a", "b"]), true);
  assert.deepEqual(loadDeletedDemoFlightIds(["a", "b", "c"]), ["a", "b"]);
  delete globalThis.window;
});

test("ignore les identifiants inconnus ou un stockage invalide", () => {
  const localStorage = memoryStorage();
  globalThis.window = { localStorage };
  localStorage.setItem(
    "balloon-companion-journal-demo-deleted-v1",
    JSON.stringify(["known", "obsolete", 42]),
  );
  assert.deepEqual(loadDeletedDemoFlightIds(["known"]), ["known"]);
  delete globalThis.window;
});
