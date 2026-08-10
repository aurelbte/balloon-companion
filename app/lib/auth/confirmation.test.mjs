import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../auth/confirmed/page.tsx", import.meta.url), "utf8");

test("la route de confirmation restaure la session et propose les deux destinations", () => {
  assert.match(source, /confirmEmail\(code\)/);
  assert.match(source, /Adresse email confirmée\./);
  assert.match(source, /Continuer vers Balloon Companion/);
  assert.match(source, /AUTH_SIGN_IN_ROUTE/);
});

test("la confirmation ne référence aucun stockage métier", () => {
  assert.doesNotMatch(source, /flight-completion|balloon-registry|recorded-flight|pilot-profile|indexedDB|localStorage|sessionStorage/i);
});
