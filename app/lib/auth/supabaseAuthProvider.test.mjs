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
      exchangeCodeForSession: async () => ({ data: { user: supabaseUser }, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: { user: supabaseUser }, error: null }),
      ...overrides,
    },
  };
}

test("la création de compte transmet uniquement firstName et lastName en metadata", async () => {
  let received;
  const provider = new SupabaseAuthProvider(fakeClient({
    signUp: async (input) => { received = input; return { data: { user: supabaseUser }, error: null }; },
  }), () => "https://balloon.example");
  const user = await provider.signUp({ email: "pilot@example.com", password: "balloon8", firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(received, {
    email: "pilot@example.com",
    password: "balloon8",
    options: {
      data: { firstName: "Ada", lastName: "Lovelace" },
      emailRedirectTo: "https://balloon.example/auth/confirmed",
    },
  });
  assert.deepEqual(user, { id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace" });
});

test("un échec signUp expose exactement error.message, error.code et error.status", async (context) => {
  const expected = { message: "Email address is invalid", code: "email_address_invalid", status: 400 };
  const calls = [];
  const previousConsoleError = console.error;
  console.error = (...args) => calls.push(args);
  try {
    const provider = new SupabaseAuthProvider(fakeClient({
      signUp: async () => ({ data: { user: null }, error: expected }),
    }), () => "https://balloon.example");
    await assert.rejects(
      () => provider.signUp({ email: "invalid", password: "balloon8", firstName: "Ada", lastName: "Lovelace" }),
      (error) => {
        assert.equal(error.name, "BalloonAuthError");
        assert.equal(error.message, expected.message);
        assert.equal(error.code, expected.code);
        assert.equal(error.status, expected.status);
        return true;
      },
    );
  } finally {
    console.error = previousConsoleError;
  }
  assert.deepEqual(calls, [["[Supabase Auth signUp]", expected]]);
  context.diagnostic(`error.message=${expected.message}; error.code=${expected.code}; error.status=${expected.status}`);
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

test("la confirmation échange le code et restaure BalloonUser", async () => {
  let receivedCode;
  const provider = new SupabaseAuthProvider(fakeClient({
    getUser: async () => ({ data: { user: null }, error: { message: "no session" } }),
    exchangeCodeForSession: async (code) => { receivedCode = code; return { data: { user: supabaseUser }, error: null }; },
  }));
  assert.deepEqual(await provider.confirmEmail("confirmation-code"), {
    id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace",
  });
  assert.equal(receivedCode, "confirmation-code");
});

test("une session déjà valide évite un second échange du code", async () => {
  let exchanges = 0;
  const provider = new SupabaseAuthProvider(fakeClient({
    exchangeCodeForSession: async () => { exchanges += 1; return { data: { user: null }, error: { message: "already used" } }; },
  }));
  assert.equal((await provider.confirmEmail("already-exchanged"))?.id, "user-1");
  assert.equal(exchanges, 0);
});

test("la demande de récupération utilise la route dédiée sans révéler le compte", async () => {
  let received;
  const provider = new SupabaseAuthProvider(fakeClient({
    resetPasswordForEmail: async (email, options) => { received = { email, options }; return { data: {}, error: null }; },
  }), () => "https://balloon.example");
  await provider.requestPasswordReset("pilot@example.com");
  assert.deepEqual(received, {
    email: "pilot@example.com",
    options: { redirectTo: "https://balloon.example/auth/reset-password" },
  });
});

test("la récupération refuse de remplacer une session existante", async () => {
  let exchanges = 0;
  const provider = new SupabaseAuthProvider(fakeClient({
    exchangeCodeForSession: async () => { exchanges += 1; return { data: { user: supabaseUser }, error: null }; },
  }));
  await assert.rejects(() => provider.recoverPassword("recovery-code", "new-balloon-password"), /AUTH_SESSION_ALREADY_ACTIVE/);
  assert.equal(exchanges, 0);
});

test("un code recovery valide est échangé puis immédiatement consommé et nettoyé", async () => {
  let receivedCode;
  let updatedPassword;
  let signedOut = false;
  const provider = new SupabaseAuthProvider(fakeClient({
    getUser: async () => ({ data: { user: null }, error: { message: "no session" } }),
    exchangeCodeForSession: async (code) => { receivedCode = code; return { data: { user: supabaseUser }, error: null }; },
    updateUser: async ({ password }) => { updatedPassword = password; return { data: { user: supabaseUser }, error: null }; },
    signOut: async () => { signedOut = true; return { error: null }; },
  }));
  await provider.recoverPassword("recovery-code", "new-balloon-password");
  assert.equal(receivedCode, "recovery-code");
  assert.equal(updatedPassword, "new-balloon-password");
  assert.equal(signedOut, true);
});

test("un code recovery invalide est refusé", async () => {
  const provider = new SupabaseAuthProvider(fakeClient({
    getUser: async () => ({ data: { user: null }, error: { message: "no session" } }),
    exchangeCodeForSession: async () => ({ data: { user: null }, error: { message: "expired", code: "otp_expired", status: 403 } }),
  }));
  await assert.rejects(() => provider.recoverPassword("expired-code", "new-balloon-password"), { name: "BalloonAuthError" });
});

test("la session recovery est fermée localement même si updateUser échoue", async () => {
  const calls = [];
  const provider = new SupabaseAuthProvider(fakeClient({
    getUser: async () => ({ data: { user: null }, error: { message: "no session" } }),
    exchangeCodeForSession: async () => ({ data: { user: supabaseUser }, error: null }),
    updateUser: async (input) => { calls.push(["update", input]); return { data: { user: null }, error: { message: "weak password" } }; },
    signOut: async (options) => { calls.push(["signOut", options]); return { error: null }; },
  }));
  await assert.rejects(() => provider.recoverPassword("recovery-code", "new-balloon-password"));
  assert.deepEqual(calls, [
    ["update", { password: "new-balloon-password" }],
    ["signOut", { scope: "local" }],
  ]);
});

test("l'intégration Supabase ne référence aucun stockage métier", () => {
  const sources = [
    "./supabaseAuthProvider.ts",
    "../supabase/client.ts",
    "../supabase/server.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /flight-completion|balloon-registry|recorded-flight|pilot-profile|indexedDB/i);
});
