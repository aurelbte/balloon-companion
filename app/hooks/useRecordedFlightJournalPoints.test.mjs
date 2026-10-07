import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./useRecordedFlightJournalPoints.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const points = [{ latitude: 50, longitude: 3 }, { latitude: 50.1, longitude: 3.1 }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function harness(t, { allowDownload = true, local = { points: [] }, online = true } = {}) {
  const oldWindow = globalThis.window, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const listeners = new Map();
  const browser = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  };
  globalThis.window = browser;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: online } });
  const slots = []; let cursor = 0, pending = [];
  const calls = []; let reads = 0, scope = "USER:test", generation = 1;
  let download = async () => { throw new Error("R2_DOWNLOAD_503"); };
  let restore = async () => { local = { points: [] }; return "RESTORED"; };
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = value; }]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((dep, j) => dep !== old.deps[j])) { slots[i] = { deps }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const mocks = {
    react,
    "../lib/flightCompletionStorage": { FLIGHT_COMPLETION_EVENT: "completion", loadRecordedFlightForJournal: async id => { assert.equal(id, "source-a"); reads++; return local; } },
    "../lib/cloudSyncVerdict": { CLOUD_SYNC_VERDICT_CHANGED_EVENT: "sync" },
    "../lib/realFlightJournal": { recordedFlightPointsToJournalPoints: value => value.points },
    "../lib/auth/dataScopeRuntime": { getRuntimeDataScope: () => scope, getRuntimeDataScopeGeneration: () => generation },
    "../lib/supabase/client": { createBrowserSupabaseClient: () => ({}) },
    "../lib/flightTrackCloudBrowser": { BrowserFlightTrackCloudService: class {
      async download(id) { calls.push(["download", id]); return download(); }
      async restoreMissingLocalMetadata(id) { calls.push(["restore", id]); return restore(); }
    } },
    "../lib/flightTrackQueue": { IndexedDbFlightTrackQueueStorage: class {}, enqueueFlightTrackJob: async (_, job) => { calls.push(["enqueue", job.flightId]); } },
  };
  const exports = {};
  new Function("require", "exports", js)(id => { assert.ok(id in mocks, id); return mocks[id]; }, exports);
  const flight = { id: "journal-a", sourceFlightId: "source-a", origin: "REAL_GPS", points: [] };
  const render = () => { cursor = 0; const value = exports.useRecordedFlightJournalPointsState(flight, allowDownload); const effects = pending; pending = []; effects.forEach(fn => fn()); return value; };
  const unmount = () => slots.forEach(slot => slot.cleanup?.());
  const emit = event => { for (const fn of listeners.get(event) ?? []) fn(); };
  t.after(() => { unmount(); if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator; });
  return { render, calls, emit, unmount, listeners, reads: () => reads, setLocal: value => { local = value; }, setDownload: fn => { download = fn; }, setRestore: fn => { restore = fn; }, switchUser: () => { scope = "USER:other"; generation++; } };
}

for (const event of ["completion", "sync"]) {
  test(`échec initial puis hydratation locale (${event}) : points visibles sans nouveau vol ni reload`, async t => {
    const h = harness(t);
    assert.equal(h.render().trackState, "LOADING_CLOUD"); await flush();
    assert.equal(h.render().trackState, "DOWNLOAD_ERROR");
    const requests = h.calls.length;
    h.setLocal({ points }); h.emit(event); await flush();
    assert.deepEqual(h.render(), { points, trackState: "LOCAL" });
    assert.equal(h.calls.length, requests, "une notification ne relance pas le transport");
  });
}

test("retour réseau : récupération via le service existant", async t => {
  const h = harness(t, { online: false }); h.render(); await flush();
  assert.equal(h.render().trackState, "CLOUD_OFFLINE"); assert.equal(h.calls.length, 0);
  h.setDownload(async () => { h.setLocal({ points }); });
  navigator.onLine = true; h.emit("online"); await flush();
  assert.deepEqual(h.render(), { points, trackState: "LOCAL" });
  assert.deepEqual(h.calls, [["download", "source-a"]]);
});

test("métadonnées absentes : restauration avant download avec sourceFlightId", async t => {
  const h = harness(t, { local: null });
  h.setDownload(async () => { h.setLocal({ points }); });
  h.render(); await flush();
  assert.deepEqual(h.calls, [["restore", "source-a"], ["download", "source-a"]]);
  assert.deepEqual(h.render(), { points, trackState: "LOCAL" });
});

for (const scenario of ["absent", "not-ready", "transport", "empty-result"]) {
  test(`état explicite sans chargement infini : ${scenario}`, async t => {
    const h = harness(t, { local: scenario === "absent" ? null : { points: [] } });
    if (scenario === "absent") h.setRestore(async () => "ABSENT");
    if (scenario === "not-ready") h.setDownload(async () => { throw new Error("REMOTE_TRACK_NOT_AVAILABLE"); });
    if (scenario === "empty-result") h.setDownload(async () => {});
    h.render(); await flush();
    assert.equal(h.render().trackState, ["absent", "not-ready"].includes(scenario) ? "REMOTE_UNAVAILABLE" : "DOWNLOAD_ERROR");
    if (scenario === "absent") assert.deepEqual(h.calls, [["restore", "source-a"]]);
  });
}

test("notification pendant un téléchargement : relecture conservée, pas de transport concurrent", async t => {
  const h = harness(t), gate = deferred(); h.setDownload(() => gate.promise);
  h.render(); await flush();
  h.setLocal({ points }); h.emit("sync"); h.emit("completion"); h.emit("online");
  assert.equal(h.calls.length, 1);
  gate.reject(new Error("R2_DOWNLOAD_503")); await flush();
  assert.deepEqual(h.render(), { points, trackState: "LOCAL" });
  assert.equal(h.calls.filter(([op]) => op === "download").length, 1);
});

test("lecteur sans téléchargement Cloud : notification hydrate la miniature localement", async t => {
  const h = harness(t, { allowDownload: false }); h.render(); await flush();
  h.setLocal({ points }); h.emit("sync"); await flush();
  assert.deepEqual(h.render(), { points, trackState: "LOCAL" }); assert.equal(h.calls.length, 0);
});

for (const scenario of ["unmount", "user-switch"]) {
  test(`réponse tardive ignorée après ${scenario}`, async t => {
    const h = harness(t), gate = deferred(); h.setDownload(() => gate.promise);
    h.render(); await flush();
    if (scenario === "unmount") {
      h.unmount();
      assert.equal([...h.listeners.values()].reduce((sum, value) => sum + value.size, 0), 0);
    } else h.switchUser();
    h.setLocal({ points }); gate.resolve(); await flush();
    assert.equal(h.render().points.length, 0);
    const reads = h.reads(); h.emit("online"); h.emit("sync"); await flush();
    assert.equal(h.reads(), reads);
  });
}
