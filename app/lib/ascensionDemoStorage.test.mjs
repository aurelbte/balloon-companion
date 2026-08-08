import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("les actions du Carnet renomment sans ouvrir l’édition officielle", () => {
  const source = readFileSync(
    new URL("../components/journal/AscensionLog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, />Renommer<\/button>/);
  assert.match(source, /> Renommer<\/button>/);
  assert.doesNotMatch(source, /router\.push\(`\/journal\/ascension\/\$\{ascension\.id\}\/edit`\)/);
  assert.match(source, /customTitles:\s*\{\s*\.\.\.state\.customTitles,\s*\[renaming\.id\]: title/);
});
