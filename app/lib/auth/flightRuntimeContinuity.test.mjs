import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const user = (id = "pilot-a") => ({ id, email: `${id}@test.invalid`, firstName: "Pilote", lastName: "Test" });
const signed = (id = "pilot-a", state = "SIGNED_IN") => ({ state, user: user(id) });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

// Execute the real AuthProvider, including effect dependencies and migration gate.
// Reconcile its keyed boundary on every render, including intermediate renders.
function harness(t) {
  const slots = []; let cursor = 0, effects = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const memo = (fn, deps) => { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; };
  const react = { ...require("react"),
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, (v) => { slots[i].value = typeof v === "function" ? v(slots[i].value) : v; }]; },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const win = Object.assign(new EventTarget(), { localStorage: {}, indexedDB: {} });
  for (const [name, value] of Object.entries({ window: win, navigator: { onLine: true } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  let pathname = "/flight", restored = signed(), signInUser = user();
  const migrations = [], pendingMigrations = [];
  const mocks = {
    react, "next/navigation": { usePathname: () => pathname },
    "../lib/auth/session.ts": { restoreAuthSnapshot: async () => ({ ...restored, user: restored.user && { ...restored.user } }), saveLocalAuthSession: () => {}, clearLocalAuthSession: () => {} },
    "../lib/auth/supabaseAuthProvider.ts": { SupabaseAuthProvider: class { async signIn() { return signInUser; } async signOut() {} } },
    "../lib/supabase/client.ts": { createBrowserSupabaseClient: () => null },
    "../lib/auth/deviceIdentity.ts": { getOrCreateDeviceIdentity: () => ({ deviceId: "device" }) },
    "../lib/auth/guestToUserMigration.ts": { migrateGuestAndLegacyToUser: (input) => { migrations.push(input.userId); const pending = deferred(); pendingMigrations.push(pending); return pending.promise; } },
    "../lib/auth/dataScopeRuntime.ts": { setRuntimeAuthSnapshot: () => {}, setRuntimeGuestModeActive: () => {}, DATA_SCOPE_CHANGED_EVENT: "scope" },
  };
  const path = new URL("../../contexts/AuthContext.tsx", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const compiledModule = { exports: {} };
  const localRequire = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith(".") ? require(new URL(id, path).pathname) : require(id);
  new Function("require", "module", "exports", outputText)(localRequire, compiledModule, compiledModule.exports);
  const Provider = compiledModule.exports.BalloonAuthProvider;
  let runtime = null, boundaryKey = null, auth;
  const transitions = [];
  const render = () => {
    cursor = 0;
    const tree = Provider({ children: "FlightRuntimeProvider" });
    auth = tree.props.value;
    const boundary = tree.props.children;
    if (!boundary || boundary.key !== boundaryKey) {
      transitions.push(boundary?.key ?? null);
      runtime = boundary ? { recording: false, points: [], gpsWatcher: {} } : null;
      boundaryKey = boundary?.key ?? null;
    }
    const pending = effects; effects = []; pending.forEach((effect) => effect());
    return runtime;
  };
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return {
    render, migrations, transitions, get auth() { return auth; },
    restore(next, path) { restored = next; pathname = path; },
    setSignInUser(next) { signInUser = next; },
    finishMigration(index = pendingMigrations.length - 1) { pendingMigrations[index].resolve({ collisions: [] }); },
    async start() { render(); await flush(); render(); render(); this.finishMigration(); await flush(); return render(); },
  };
}

test("même user + nouveau snapshot auth : runtime, watcher et vol conservés", async (t) => {
  const h = harness(t), runtime = await h.start();
  runtime.recording = true; runtime.points.push("fix-1");
  const transitions = h.transitions.length;
  h.setSignInUser({ ...user(), firstName: "Profil actualisé" });
  await h.auth.signIn({ email: "test", password: "test" });
  assert.equal(h.render(), runtime);
  assert.equal(h.render(), runtime); // détecte une remise à null par l'effet
  await flush();
  assert.equal(h.render(), runtime);
  assert.equal(h.auth.user.firstName, "Profil actualisé");
  assert.deepEqual(h.migrations, ["pilot-a"]);
  assert.equal(h.transitions.length, transitions);
  assert.equal(runtime.recording, true);
  assert.deepEqual(runtime.points, ["fix-1"]);
});

test("navigation pendant un vol et restaurations online/offline du même user : aucune rupture", async (t) => {
  const h = harness(t), runtime = await h.start();
  runtime.recording = true;
  for (const [path, state] of [["/weather", "SIGNED_IN"], ["/flight", "OFFLINE_SESSION"], ["/prepare", "SIGNED_IN"], ["/flight", "SIGNED_IN"]]) {
    h.restore(signed("pilot-a", state), path);
    assert.equal(h.render(), runtime);
    await flush();
    assert.equal(h.render(), runtime);
    assert.equal(h.render(), runtime);
    assert.equal(runtime.recording, true);
  }
  assert.deepEqual(h.migrations, ["pilot-a"]);
});

test("changement réel de user : ancien runtime retiré, nouveau bloqué jusqu'à migration", async (t) => {
  const h = harness(t), previous = await h.start();
  previous.recording = true;
  h.restore(signed("pilot-b"), "/weather");
  h.render(); await flush();
  assert.equal(h.render(), null);
  assert.equal(h.render(), null);
  assert.deepEqual(h.migrations, ["pilot-a", "pilot-b"]);
  h.finishMigration(); await flush();
  const next = h.render();
  assert.notEqual(next, previous);
  assert.equal(next.recording, false);
  assert.equal(h.auth.user.id, "pilot-b");
});

test("logout : runtime remplacé et migration tardive de l'ancien compte ignorée", async (t) => {
  const h = harness(t), previous = await h.start();
  previous.recording = true;
  h.restore(signed("pilot-b"), "/weather");
  h.render(); await flush(); h.render();
  await h.auth.signOut();
  const loggedOut = h.render(); h.render();
  assert.notEqual(loggedOut, previous);
  assert.equal(loggedOut.recording, false);
  assert.equal(h.auth.state, "SIGNED_OUT");
  assert.equal(h.auth.authChoiceState, "AUTH_CHOICE_PENDING");
  h.finishMigration(); await flush();
  assert.equal(h.render(), loggedOut);
  assert.equal(h.auth.user, null);
});

test("callback auth isolé : aucun runtime utilisateur conservé dans cette surface", async (t) => {
  const h = harness(t), previous = await h.start();
  h.restore(signed(), "/auth/confirmed");
  assert.notEqual(h.render(), previous);
  assert.equal(h.auth.state, "UNKNOWN");
});

test("restauration du même user pendant la migration initiale : aucune relance ni annulation", async (t) => {
  const h = harness(t);
  h.render(); await flush(); h.render();
  assert.deepEqual(h.migrations, ["pilot-a"]);
  h.restore(signed("pilot-a", "OFFLINE_SESSION"), "/weather");
  h.render(); await flush(); h.render(); h.render();
  assert.deepEqual(h.migrations, ["pilot-a"]);
  h.finishMigration(); await flush();
  assert.ok(h.render());
});

test("logout direct pendant un vol : frontière remplacée, invité ensuite sans ancien runtime", async (t) => {
  const h = harness(t), previous = await h.start();
  previous.recording = true; previous.points.push("private-fix");
  await h.auth.signOut();
  const loggedOut = h.render();
  assert.notEqual(loggedOut, previous);
  assert.equal(loggedOut.recording, false);
  assert.equal(h.auth.authChoiceState, "AUTH_CHOICE_PENDING");
  h.auth.activateGuestMode();
  const guest = h.render();
  assert.notEqual(guest, previous);
  assert.deepEqual(guest.points, []);
  assert.deepEqual(h.migrations, ["pilot-a"]);
});
