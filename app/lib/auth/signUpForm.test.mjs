import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSignUpDraft } from "./signUpForm.ts";

const validDraft = {
  firstName: "  Ada  ",
  lastName: "  Lovelace  ",
  email: "  PILOT@EXAMPLE.COM  ",
  password: "balloon8",
  passwordConfirmation: "balloon8",
};

test("le formulaire de création rend les cinq champs et les actions", () => {
  const source = readFileSync(new URL("../../auth/sign-up/page.tsx", import.meta.url), "utf8");
  for (const label of ["Prénom", "Nom", "Adresse e-mail", "Mot de passe", "Confirmation du mot de passe", "Créer mon compte", "J’ai déjà un compte"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /AUTH_SIGN_IN_ROUTE/);
  assert.match(source, /\/branding\/balloon-companion-logo-account\.png/);
  assert.match(source, /alt="Balloon Companion"/);
  assert.match(source, /message: \$\{error\.message\}.*code:.*error\.code.*status:.*error\.status/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|supabase/i);
});

test("les champs obligatoires sont refusés", () => {
  const result = validateSignUpDraft({ firstName: "", lastName: "", email: "", password: "", passwordConfirmation: "" });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["email", "firstName", "lastName", "password", "passwordConfirmation"].sort());
});

test("un email invalide est refusé", () => {
  assert.equal(validateSignUpDraft({ ...validDraft, email: "pilote@invalid" }).errors.email, "E-mail invalide.");
});

test("un mot de passe de moins de huit caractères est refusé", () => {
  const result = validateSignUpDraft({ ...validDraft, password: "1234567", passwordConfirmation: "1234567" });
  assert.equal(result.errors.password, "8 caractères minimum.");
});

test("une confirmation différente est refusée", () => {
  assert.equal(validateSignUpDraft({ ...validDraft, passwordConfirmation: "different" }).errors.passwordConfirmation, "Les mots de passe diffèrent.");
});

test("les noms sont trimés et l'email est normalisé en minuscules", () => {
  const result = validateSignUpDraft(validDraft);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { firstName: "Ada", lastName: "Lovelace", email: "pilot@example.com", password: "balloon8" });
});
