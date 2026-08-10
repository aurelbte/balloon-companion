import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSignInDraft } from "./signInForm.ts";

const validDraft = { email: "  PILOT@EXAMPLE.COM  ", password: "balloon8" };

test("le formulaire de connexion rend les champs et les actions", () => {
  const source = readFileSync(new URL("../../auth/sign-in/page.tsx", import.meta.url), "utf8");
  for (const label of ["Adresse e-mail", "Mot de passe", "Se connecter", "Créer un compte", "Mot de passe oublié"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /AUTH_SIGN_UP_ROUTE/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|supabase/i);
});

test("un email invalide est refusé", () => {
  assert.equal(validateSignInDraft({ ...validDraft, email: "pilot@invalid" }).errors.email, "E-mail invalide.");
});

test("un mot de passe court est refusé", () => {
  assert.equal(validateSignInDraft({ ...validDraft, password: "1234567" }).errors.password, "8 caractères minimum.");
});

test("l'email est trimé et normalisé en minuscules", () => {
  const result = validateSignInDraft(validDraft);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { email: "pilot@example.com", password: "balloon8" });
});
