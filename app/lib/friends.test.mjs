import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { friendOnboardingDefaults, normalizeFriendHandle, prefillFriendIdentityField, proposeFriendHandle, saveFriendProfile, sendFriendRequest, validateFriendHandle } from "./friends.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260828120000_friends_foundation.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../more/friends/page.tsx", import.meta.url), "utf8");
const morePage = readFileSync(new URL("../more/page.tsx", import.meta.url), "utf8");

test("les identifiants sont normalisés et validés sans adresse email", () => {
  assert.equal(normalizeFriendHandle(" Charles.Grelin "), "charles.grelin");
  assert.equal(validateFriendHandle("charles.grelin"), null);
  assert.notEqual(validateFriendHandle("ab"), null);
  assert.notEqual(validateFriendHandle("avec espace"), null);
  assert.notEqual(validateFriendHandle("pilot@example.com"), null);
});

test("le nom connu préremplit le nom affiché et propose un identifiant modifiable", () => {
  assert.deepEqual(friendOnboardingDefaults({ authFirstName: "Aurélien", authLastName: "Boitte" }), {
    displayName: "Aurélien Boitte",
    handle: "aurelien.boitte",
  });
  assert.deepEqual(friendOnboardingDefaults({ authFirstName: "Auth", authLastName: "User", profileFirstName: "Charles", profileLastName: "Grelin" }), {
    displayName: "Charles Grelin",
    handle: "charles.grelin",
  });
  assert.match(page, /value=\{handle\}/);
  assert.match(page, /handleEditedRef\.current = true; setHandle/);
});

test("une identité arrivée après le premier rendu remplit seulement les champs intacts", () => {
  let displayName = prefillFriendIdentityField("", "", false);
  let handle = prefillFriendIdentityField("", "", false);
  assert.deepEqual({ displayName, handle }, { displayName: "", handle: "" });

  const hydrated = friendOnboardingDefaults({ authFirstName: "", authLastName: "", profileFirstName: "Aurélien", profileLastName: "Boitte" });
  displayName = prefillFriendIdentityField(displayName, hydrated.displayName, false);
  handle = prefillFriendIdentityField(handle, hydrated.handle, false);
  assert.deepEqual({ displayName, handle }, { displayName: "Aurélien Boitte", handle: "aurelien.boitte" });

  assert.equal(prefillFriendIdentityField("Nom saisi", "Charles Grelin", true), "Nom saisi");
  assert.equal(prefillFriendIdentityField("identifiant.saisi", "charles.grelin", true), "identifiant.saisi");
  assert.match(page, /usePilotProfile\(\)/);
  assert.match(page, /displayNameEditedRef\.current/);
  assert.match(page, /handleEditedRef\.current/);
});

test("la proposition nettoie accents, casse, espaces et caractères spéciaux", () => {
  assert.equal(proposeFriendHandle("  ÉLÉONORE  ", "  D'Ángelo!! "), "eleonore.dangelo");
  assert.equal(proposeFriendHandle("Jean   Pierre", ". Dupont ."), "jean.pierre.dupont");
  assert.equal(proposeFriendHandle("Charles", "Grelin"), "charles.grelin");
});

test("un conflit d'unicité produit un message clair sans suffixe automatique", async () => {
  const client = { from: () => ({ upsert: async () => ({ error: { code: "23505", message: "duplicate key" } }) }) };
  await assert.rejects(
    () => saveFriendProfile(client, { userId: "user-a", displayName: "Aurélien Boitte", handle: "aurelien.boitte", searchEnabled: true }),
    /Cet identifiant est déjà utilisé\. Choisissez-en un autre\./,
  );
});

test("le client refuse une demande vers soi-même avant tout accès Supabase", async () => {
  await assert.rejects(() => sendFriendRequest({}, "user-a", "user-a"), /vous-même/);
});

test("la migration impose unicité insensible à la casse et paire canonique", () => {
  assert.match(migration, /unique index friend_profiles_handle_ci_idx[\s\S]*lower\(handle\)/);
  assert.match(migration, /friend_requests_pending_pair_idx[\s\S]*least\(sender_id, recipient_id\)[\s\S]*greatest\(sender_id, recipient_id\)[\s\S]*status = 'pending'/);
  assert.match(migration, /check \(user_a < user_b\)/);
  assert.match(migration, /unique \(user_a, user_b\)/);
});

test("les transitions sensibles sont atomiques et contrôlées par auth.uid", () => {
  assert.match(migration, /accept_friend_request[\s\S]*for update[\s\S]*request\.recipient_id <> actor_id[\s\S]*insert into public\.friendships[\s\S]*update public\.friend_requests set status = 'accepted'/);
  assert.match(migration, /decline_friend_request[\s\S]*recipient_id = actor_id[\s\S]*status = 'pending'/);
  assert.match(migration, /revoke_friendship[\s\S]*actor_id in \(user_a, user_b\)/);
  assert.doesNotMatch(migration, /grant .*service_role/i);
});

test("la recherche exclut email et respecte search_enabled", () => {
  assert.doesNotMatch(migration.match(/create table public\.friend_profiles[\s\S]*?\);/)?.[0] ?? "", /email/i);
  assert.match(page, /searchFriendProfiles/);
  assert.match(page, /Retrouvez d’autres pilotes sans partager votre adresse email/);
  assert.doesNotMatch(page, /auth\.user\?\.email/);
});

test("la page efface ses collections au changement USER et n'ajoute aucun partage live", () => {
  assert.match(page, /setSnapshot\(EMPTY_SNAPSHOT\)/);
  assert.match(page, /setResults\(\[\]\)/);
  assert.match(page, /auth\.user\?\.id !== userId/);
  assert.match(page, /Bientôt disponible/);
  assert.doesNotMatch(page, /realtime|FlightMap|geolocation|position GPS/i);
  assert.match(morePage, /href="\/more\/friends"/);
});
