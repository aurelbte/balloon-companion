import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const menu = readFileSync(new URL("../../more/page.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../../auth/page.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");

test("SIGNED_OUT affiche uniquement les trois actions de compte", () => {
  for (const label of ["Créer un compte", "Se connecter", "Continuer sans compte"]) {
    assert.match(menu, new RegExp(label));
  }
  assert.match(menu, /auth\.state === "SIGNED_OUT"/);
  assert.match(account, /auth\.state === "SIGNED_OUT"/);
});

test("SIGNED_IN et OFFLINE_SESSION affichent l'identité et la déconnexion", () => {
  assert.match(menu, /auth\.user\?\.firstName/);
  assert.match(menu, /auth\.user\?\.lastName/);
  assert.match(menu, /auth\.user\?\.email/);
  assert.match(menu, /auth\.state === "OFFLINE_SESSION" \? "Hors ligne" : "Connecté"/);
  assert.match(menu, /auth\.signOut\(\)/);
  assert.match(menu, /auth\.state === "SIGNED_OUT" \? \([\s\S]*Créer un compte[\s\S]*\) : \(/);
});

test("UNKNOWN reste neutre pendant restoreSession et évite le flash SIGNED_OUT", () => {
  assert.match(context, /useState<AuthSnapshot>\(UNKNOWN_AUTH_SNAPSHOT\)/);
  assert.match(context, /restoreAuthSnapshot\([\s\S]*\.then\(\(restored\) => \{ if \(active\) setSnapshot\(restored\); \}\)/);
  assert.match(menu, /auth\.state === "UNKNOWN" \? \([\s\S]*Vérification de la session/);
  assert.match(account, /auth\.state === "UNKNOWN" \? \([\s\S]*Vérification de la session/);
});

test("signOut passe à SIGNED_OUT sans API de suppression métier", () => {
  assert.match(context, /await provider\.signOut\(\);[\s\S]*clearLocalAuthSession\(window\.localStorage\);[\s\S]*setSnapshot\(\{ state: "SIGNED_OUT", user: null \}\)/);
  assert.doesNotMatch(context, /localStorage\.clear|indexedDB\.deleteDatabase|clearFlights|clearBalloons|clearDocuments|clearPreferences|clearDeviceIdentity/i);
});
