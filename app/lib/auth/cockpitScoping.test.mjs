import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cockpit = readFileSync(new URL("../../page.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");
const authEntry = readFileSync(new URL("../../auth/page.tsx", import.meta.url), "utf8");

test("SIGNED_OUT sans choix affiche un cockpit neutre sans identité ni statistiques legacy", () => {
  assert.match(cockpit, /auth\.state === "SIGNED_OUT" && auth\.authChoiceState === "AUTH_CHOICE_PENDING"/);
  assert.match(cockpit, /if \(choicePending\)[\s\S]*Bienvenue[\s\S]*Balloon Companion[\s\S]*Le copilote numérique des pilotes de montgolfière\./);
  const neutral = cockpit.slice(cockpit.indexOf("if (choicePending)"), cockpit.indexOf("return (", cockpit.indexOf("if (choicePending)")));
  assert.doesNotMatch(neutral, /CockpitHeroRing|PilotStatusCard|LastFlightCard|MyBalloonsCard|Aurélien|MOCK_COCKPIT_DATA/);
  assert.doesNotMatch(cockpit, /Bonjour Aurélien/);
});

test("la welcome screen expose directement les trois actions sans navigation métier", () => {
  const welcome = cockpit.slice(cockpit.indexOf("if (choicePending)"), cockpit.indexOf("return (", cockpit.indexOf("if (choicePending)")));
  for (const label of ["Se connecter", "Créer un compte", "Continuer en mode invité"]) assert.match(welcome, new RegExp(label));
  assert.doesNotMatch(welcome, /NavigationBar|Votre cockpit est prêt|Choisir comment continuer|Balloon-Companion/);
});

test("Continuer sans compte active explicitement GUEST", () => {
  assert.match(authEntry, /Continuer sans compte[\s\S]*|auth\.activateGuestMode\(\)/);
  assert.match(context, /activateGuestMode[\s\S]*setAuthChoiceState\("GUEST_ACTIVE"\)/);
});

test("logout revient à AUTH_CHOICE_PENDING et ne relance aucune migration", () => {
  assert.match(context, /const signOut[\s\S]*clearLocalAuthSession[\s\S]*setAuthChoiceState\("AUTH_CHOICE_PENDING"\)[\s\S]*setSnapshot\(\{ state: "SIGNED_OUT"/);
  const signOut = context.slice(context.indexOf("const signOut"), context.indexOf("const activateGuestMode"));
  assert.doesNotMatch(signOut, /migrateApprovedLegacyData|inspectLegacyLocalData|startApprovedMigration/);
});

test("le dernier vol du cockpit vient du carnet scoped et non du mock", () => {
  assert.match(cockpit, /completion\.journalFlights/);
  assert.doesNotMatch(cockpit, /MOCK_COCKPIT_DATA\.lastFlight/);
});
