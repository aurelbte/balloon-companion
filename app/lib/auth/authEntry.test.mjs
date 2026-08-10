import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { continueWithoutAccount } from "./entry.ts";

const entrySource = readFileSync(new URL("../../auth/page.tsx", import.meta.url), "utf8");

test("l'écran Auth affiche le contenu et les trois actions", () => {
  assert.match(entrySource, /Balloon Companion/);
  assert.match(entrySource, /Construit par un pilote, pour des pilotes\./);
  assert.match(entrySource, /Créer un compte/);
  assert.match(entrySource, /Se connecter/);
  assert.match(entrySource, /Continuer sans compte/);
});

test("continuer sans compte conserve SIGNED_OUT", () => {
  assert.deepEqual(continueWithoutAccount(), { state: "SIGNED_OUT", user: null });
});

test("la surface Auth ne touche aucun stockage métier et ne déclenche aucun réseau", () => {
  assert.doesNotMatch(entrySource, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(entrySource, /localStorage|sessionStorage|indexedDB/);
});
