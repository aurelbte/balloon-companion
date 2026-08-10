import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SupabaseAuthProvider } from "./supabaseAuthProvider.ts";

const supabaseUser = {
  id: "user-1",
  email: "PILOT@EXAMPLE.COM",
  user_metadata: { firstName: "Ada", lastName: "Lovelace" },
};

function fakeClient(overrides = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: supabaseUser }, error: null }),
      signUp: async () => ({ data: { user: supabaseUser }, error: null }),
      signInWithPassword: async () => ({ data: { user: supabaseUser }, error: null }),
      signOut: async () => ({ error: null }),
      ...overrides,
    },
  };
}

test("la création de compte transmet uniquement firstName et lastName en metadata", async () => {
  let received;
  const provider = new SupabaseAuthProvider(fakeClient({
    signUp: async (input) => { received = input; return { data: { user: supabaseUser }, error: null }; },
  }));
  const user = await provider.signUp({ email: "pilot@example.com", password: "balloon8", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(received, {
    email: "pilot@example.com",
    password: "balloon8",
    options: { data: { firstName: "Ada", lastName: "Lovelace" } },
  });
  assert.deepEqual(user, { id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace" });
});

test("la connexion restaure BalloonUser", async () => {
  let received;
  const provider = new SupabaseAuthProvider(fakeClient({
    signInWithPassword: async (input) => { received = input; return { data: { user: supabaseUser }, error: null }; },
  }));
  assert.deepEqual(await provider.signIn({ email: "pilot@example.com", password: "balloon8" }), {
    id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace",
  });
  assert.deepEqual(received, { email: "pilot@example.com", password: "balloon8" });
});

test("la déconnexion supprime uniquement la session locale Supabase", async () => {
  let received;
  const provider = new SupabaseAuthProvider(fakeClient({
    signOut: async (options) => { received = options; return { error: null }; },
  }));
  await provider.signOut();
  assert.deepEqual(received, { scope: "local" });
});

test("restoreSession utilise l'utilisateur Supabase courant", async () => {
  const provider = new SupabaseAuthProvider(fakeClient());
  assert.deepEqual(await provider.restoreSession(), {
    id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace",
  });
});

test("l'intégration Auth ne référence aucun stockage métier", () => {
  const sources = [
    "../../contexts/AuthContext.tsx",
    "./supabaseAuthProvider.ts",
    "../supabase/client.ts",
    "../supabase/server.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /flight-completion|balloon-registry|recorded-flight|pilot-profile|indexedDB/i);
});
