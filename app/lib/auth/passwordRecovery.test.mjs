import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isIsolatedAuthCallbackPath } from "./authCallbackPath.ts";
import { normalizeRecoveryEmail, validatePasswordRecoveryDraft } from "./passwordRecoveryForm.ts";

test("l'adresse recovery est normalisée et validée", () => {
  assert.equal(normalizeRecoveryEmail(" PILOT@EXAMPLE.COM "), "pilot@example.com");
  assert.equal(normalizeRecoveryEmail("unknown"), null);
});

test("la validation recovery reprend les règles existantes et refuse les mots de passe différents", () => {
  assert.deepEqual(validatePasswordRecoveryDraft({ password: "balloon8", passwordConfirmation: "different8" }), {
    valid: false,
    passwordError: undefined,
    confirmationError: "Les mots de passe diffèrent.",
  });
  assert.equal(validatePasswordRecoveryDraft({ password: "balloon8", passwordConfirmation: "balloon8" }).valid, true);
});

test("seuls les callbacks Auth nécessaires sont isolés du scope USER", () => {
  assert.equal(isIsolatedAuthCallbackPath("/auth/confirmed"), true);
  assert.equal(isIsolatedAuthCallbackPath("/auth/reset-password"), true);
  assert.equal(isIsolatedAuthCallbackPath("/auth/sign-in"), false);
  assert.equal(isIsolatedAuthCallbackPath("/more"), false);
});

test("le parcours recovery reste anti-énumération et hors stockages métier", () => {
  const forgot = readFileSync(new URL("../../auth/forgot-password/page.tsx", import.meta.url), "utf8");
  const reset = readFileSync(new URL("../../auth/reset-password/page.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");
  assert.match(forgot, /Si un compte existe pour cette adresse/);
  assert.match(forgot, /catch \{ \/\* Réponse volontairement identique\. \*\//);
  assert.match(reset, /history\.replaceState/);
  assert.match(reset, /recoverPassword/);
  assert.match(context, /effectiveSnapshot = isolatedAuthCallback \? UNKNOWN_AUTH_SNAPSHOT : snapshot/);
  assert.doesNotMatch(`${forgot}\n${reset}`, /flight-completion|recorded-flight|indexedDB|CloudSync|R2/i);
});
