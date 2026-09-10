import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { CloudBackfillService } from "./cloudBackfillService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const require = createRequire(import.meta.url);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// Execute the real hook bodies with a deterministic hook dispatcher. Browser
// callbacks, timers and storage failures are controlled; domain code is real.
function loadModule(relative, mocks = {}) {
  const path = resolve(dirname(new URL(import.meta.url).pathname), relative);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    return id.startsWith(".") ? require(resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`)) : require(id);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

function hookDispatcher() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => value !== b[index]);
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useCallback(callback, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { value: callback, deps }; return slots[index].value; },
      useEffect(effect, deps) {
        const index = cursor++;
        if (changed(slots[index]?.deps, deps)) {
          const previous = slots[index];
          slots[index] = { deps, cleanup: previous?.cleanup };
          pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
        }
      },
    },
    render(hook) { cursor = 0; const result = hook(); const effects = pending; pending = []; effects.forEach((effect) => effect()); return result; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function browser(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 100_000 });
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  win.setInterval = (...args) => setInterval(...args);
  win.clearInterval = (...args) => clearInterval(...args);
  win.setTimeout = (...args) => setTimeout(...args);
  win.clearTimeout = (...args) => clearTimeout(...args);
  for (const [key, value] of Object.entries({ window: win, document: doc })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  t.mock.method(console, "error", () => {});
  return { doc, visibility(value) { doc.visibilityState = value; doc.dispatchEvent(new Event("visibilitychange")); } };
}

const point = (timestamp = Date.now()) => ({ latitude: 50.8, longitude: 2.68, altitude: 100, accuracy: 5, speed: 3, heading: 45, timestamp });

async function tracking(t, storage = new MemoryRecordedFlightStorage(), extra = {}) {
  const hooks = hookDispatcher();
  t.after(() => hooks.unmount());
  browser(t);
  const journal = [];
  const { useFlightTracking } = loadModule("../hooks/useFlightTracking.ts", {
    react: hooks.react,
    "../lib/flightCompletionStorage": { persistRecordedFlightInJournal: (flight) => { journal.push(flight); return { persisted: true }; }, enrichJournalFlightLocations: () => {} },
    "../lib/flightSessionStorage": { loadFlightSession: () => null },
    "../lib/preparationDraftStorage": { loadPreparationDraft: () => null },
    "../lib/auth/dataScopeRuntime": { getRuntimeDataScope: () => "GUEST" },
    ...extra,
  });
  const render = () => hooks.render(() => useFlightTracking({ storage }));
  render(); await flush();
  return { render, storage, journal, current: render() };
}

test("ignorer conserve le verrou, l'identité et la trace récupérables", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const flight = createRecordedFlight({ id: "old", startedAt: 1_000 });
  await storage.saveActiveFlight(flight);
  const h = await tracking(t, storage);
  h.current.ignoreInterruptedFlight();
  assert.equal(await h.render().startTracking(point()), false);
  assert.equal(h.render().recoverableFlight.id, "old");
  assert.equal((await storage.getActiveFlight()).id, "old");
  await assert.rejects(storage.saveActiveFlight(createRecordedFlight({ id: "new" })));
  assert.equal(await h.render().abandonInterruptedFlight(), true);
  assert.equal(await h.render().startTracking(point()), true);
});

test("départ confirmé seulement après le commit local, doubles clics coalescés", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const gate = deferred();
  const save = storage.saveActiveFlight.bind(storage);
  let writes = 0;
  storage.saveActiveFlight = async (flight) => { writes++; await gate.promise; await save(flight); };
  const h = await tracking(t, storage);
  const first = h.current.startTracking(point());
  await flush();
  assert.equal(h.render().isTracking, false);
  assert.equal(await h.render().startTracking(point()), false);
  assert.equal(writes, 1);
  gate.resolve();
  assert.equal(await first, true);
  assert.equal(h.render().activeFlight.id, (await storage.getActiveFlight()).id);
});

test("lecture IndexedDB indisponible refuse le départ et reste Ready", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  storage.getActiveFlight = async () => { throw new Error("IndexedDB unavailable"); };
  const h = await tracking(t, storage);
  assert.equal(await h.current.startTracking(point()), false);
  assert.equal(h.render().status, "ready");
  assert.equal(h.render().activeFlight, null);
  assert.ok(h.render().storageError);
});

test("première écriture refusée : aucune session démarrée, nouvel essai possible", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const save = storage.saveActiveFlight.bind(storage);
  storage.saveActiveFlight = async () => { throw new Error("QuotaExceededError"); };
  const h = await tracking(t, storage);
  h.current.markAcquiring();
  assert.equal(await h.render().startTracking(point()), false);
  assert.equal(h.render().status, "ready");
  assert.equal(await storage.getActiveFlight(), null);
  storage.saveActiveFlight = save;
  assert.equal(await h.render().startTracking(point()), true);
});

test("récupération : fin au dernier point, pas à la réouverture du lendemain", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  await storage.saveActiveFlight({ ...createRecordedFlight({ id: "interrupted", startedAt: 1_000 }), points: [point(1_000), point(61_000)] });
  const h = await tracking(t, storage);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  t.mock.timers.tick(86_400_000);
  const completed = await h.current.completeInterruptedFlight();
  assert.equal(completed.endedAt, 61_000);
  assert.equal(completed.summary.durationSeconds, 60);
  assert.equal(await storage.getActiveFlight(), null);
});

test("récupération sans point : estimation limitée au début enregistré", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  await storage.saveActiveFlight(createRecordedFlight({ id: "no-fix", startedAt: 1_000 }));
  const h = await tracking(t, storage);
  assert.equal((await h.current.completeInterruptedFlight()).endedAt, 1_000);
});

test("fin locale immédiate malgré géocodage bloqué, sans résurrection par les timers", async (t) => {
  const h = await tracking(t);
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => { signal = options.signal; return new Promise(() => {}); });
  await h.current.startTracking(point());
  const first = h.render().stopTracking();
  const second = h.render().stopTracking();
  const completed = await first;
  assert.equal((await second).id, completed.id);
  assert.equal(h.render().status, "stopped");
  assert.equal(h.journal.length, 1);
  assert.equal(await h.storage.getActiveFlight(), null);
  assert.equal(completed.endLocationLabel, "Arrivée inconnue");
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(10_000); await flush();
  assert.equal(signal.aborted, true);
  assert.equal(await h.storage.getActiveFlight(), null);
  assert.equal((await h.storage.listFlights()).length, 1);
});

test("échec de commit final : vol actif conservé, fin réessayable", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const complete = storage.completeFlight.bind(storage);
  const h = await tracking(t, storage);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await h.current.startTracking(point());
  storage.completeFlight = async () => { throw new Error("transaction aborted"); };
  assert.equal(await h.render().stopTracking(), null);
  assert.equal(h.render().isTracking, true);
  assert.equal((await storage.getActiveFlight()).status, "RECORDING");
  storage.completeFlight = complete;
  assert.ok(await h.render().stopTracking());
  assert.equal(h.render().isTracking, false);
});

test("ancien activeFlight COMPLETED rendu visible sans recalcul ni doublon", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const completed = finalizeRecordedFlight(createRecordedFlight({ id: "old-bug", startedAt: 1_000 }), 61_000);
  await storage.saveActiveFlight(completed);
  const h = await tracking(t, storage);
  assert.equal(h.current.completedFlight.endedAt, 61_000);
  assert.equal(await storage.getActiveFlight(), null);
  assert.equal((await storage.listFlights()).length, 1);
  assert.equal(h.journal[0].id, "old-bug");
});

test("ancien COMPLETED : réparation en échec reste visible et peut être réessayée", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  const completed = finalizeRecordedFlight(createRecordedFlight({ id: "old-bug", startedAt: 1_000 }), 61_000);
  await storage.saveActiveFlight(completed);
  const complete = storage.completeFlight.bind(storage);
  storage.completeFlight = async () => { throw new Error("unavailable"); };
  const h = await tracking(t, storage);
  assert.equal(h.current.recoverableFlight.status, "COMPLETED");
  h.current.resumeInterruptedFlight();
  assert.equal(h.render().isTracking, false);
  assert.equal(await h.render().startTracking(point()), false);
  storage.completeFlight = complete;
  assert.equal((await h.render().completeInterruptedFlight()).endedAt, 61_000);
});

function gps(t) {
  const hooks = hookDispatcher();
  t.after(() => hooks.unmount());
  const env = browser(t);
  let nextId = 0;
  const watches = new Map();
  const active = new Set();
  const geolocation = {
    watchPosition(success, error) { const id = ++nextId; watches.set(id, { success, error }); active.add(id); return id; },
    clearWatch(id) { active.delete(id); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation } });
  t.after(() => Object.defineProperty(globalThis, "navigator", descriptor));
  const { useGeolocation } = loadModule("../hooks/useGeolocation.ts", { react: hooks.react });
  const render = () => hooks.render(() => useGeolocation());
  return { ...env, render, current: render(), watches, active, count: () => nextId,
    error(id, code) { watches.get(id).error({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); },
    fix(id, timestamp = Date.now()) { watches.get(id).success({ timestamp, coords: { ...point(timestamp), altitudeAccuracy: 5 } }); },
  };
}

for (const code of [2, 3]) test(`GPS erreur transitoire ${code} : retry unique, callbacks anciens ignorés`, (t) => {
  const h = gps(t);
  h.current.requestPermission(); h.fix(1);
  h.error(1, code); h.error(1, code);
  h.render().requestPermission();
  assert.equal(h.active.size, 0);
  t.mock.timers.tick(1_999); assert.equal(h.count(), 1);
  t.mock.timers.tick(1); assert.equal(h.count(), 2);
  assert.equal(h.active.size, 1);
  h.error(1, 1); // An obsolete permission callback must not stop watcher 2.
  h.fix(2);
  assert.equal(h.render().state, "active");
  t.mock.timers.tick(11_000);
  assert.equal(h.render().isStale, true);
  h.fix(2);
  assert.equal(h.render().isStale, false);
});

test("GPS permission refusée terminale, arrêt explicite annule tout retry", (t) => {
  const h = gps(t);
  h.current.requestPermission(); h.error(1, 1);
  h.visibility("hidden"); h.visibility("visible");
  t.mock.timers.tick(30_000);
  assert.equal(h.count(), 1);
  assert.equal(h.render().state, "permission_denied");
  h.render().requestPermission(); h.error(2, 3);
  h.render().stopTracking();
  t.mock.timers.tick(30_000); h.visibility("visible");
  assert.equal(h.count(), 2);
  assert.equal(h.active.size, 0);
});

test("GPS retour au premier plan réarme un watcher absent ou périmé, jamais deux", (t) => {
  const h = gps(t);
  h.current.requestPermission(); h.fix(1);
  h.visibility("hidden"); h.error(1, 3);
  t.mock.timers.tick(15_000);
  assert.equal(h.count(), 1);
  h.visibility("visible"); assert.equal(h.count(), 2);
  h.fix(2); h.visibility("visible"); assert.equal(h.count(), 2);
  h.visibility("hidden"); t.mock.timers.tick(15_000); h.visibility("visible");
  assert.equal(h.count(), 3);
  assert.equal(h.active.size, 1);
});

// Minimal transactional IDB double: runs actual storage callbacks and commits
// their writes together, or discards the transaction on abort.
function database() {
  let stores = new Map([["activeFlight", new Map()], ["flights", new Map()]]);
  let fail = false;
  return {
    abortNext() { fail = true; },
    transaction() {
      const copy = structuredClone(stores);
      let pending = 0, aborted = false;
      const transaction = {
        objectStore(name) {
          const map = copy.get(name);
          return {
            get(key) { const request = {}; pending++; queueMicrotask(() => { request.result = map.get(key); if (!aborted) request.onsuccess?.(); pending--; finish(); }); return request; },
            put(value) { map.set(name === "activeFlight" ? value.key : value.id, structuredClone(value)); },
            delete(key) { map.delete(key); },
          };
        },
        abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); },
      };
      function finish() {
        if (pending || aborted) return;
        if (fail) { fail = false; transaction.abort(); return; }
        stores = copy;
        transaction.oncomplete?.();
      }
      queueMicrotask(finish);
      return transaction;
    },
    read(store, key) { return stores.get(store).get(key); },
  };
}

for (const mode of ["reject", "blocked", "false"]) test(`commit IndexedDB indépendant des files Cloud/R2 (${mode})`, async () => {
  const queue = () => mode === "blocked" ? new Promise(() => {}) : mode === "false" ? Promise.resolve(false) : Promise.reject(new Error("queue unavailable"));
  const { IndexedDbRecordedFlightStorage } = loadModule("./recordedFlightStorage.ts", {
    "./auth/dataScopeRuntime.ts": { getRuntimeDataScope: () => "USER:pilot" },
    "./syncOutbox.ts": { enqueueLocalSyncMutation: queue },
    "./flightTrackQueue.ts": { enqueueFlightTrackJob: queue, IndexedDbFlightTrackQueueStorage: class {} },
  });
  const db = database();
  const storage = new IndexedDbRecordedFlightStorage();
  storage.scope = "USER:pilot";
  storage.database = async () => db;
  const flight = { ...createRecordedFlight({ id: "local", startedAt: 1_000 }), points: [point(1_000)] };
  await storage.saveActiveFlight(flight);
  await storage.completeFlight(finalizeRecordedFlight(flight, 61_000));
  assert.equal(db.read("activeFlight", "current"), undefined);
  assert.equal(db.read("flights", "local").status, "COMPLETED");
  await flush();
  assert.equal(db.read("activeFlight", "current"), undefined);
  await assert.rejects(storage.saveActiveFlight(flight));
});

test("IndexedDB : pas d'écrasement d'un autre actif, abort final sans perte", async () => {
  const { IndexedDbRecordedFlightStorage } = loadModule("./recordedFlightStorage.ts", {
    "./auth/dataScopeRuntime.ts": { getRuntimeDataScope: () => "GUEST" },
    "./syncOutbox.ts": { enqueueLocalSyncMutation: async () => true },
  });
  const db = database();
  const storage = new IndexedDbRecordedFlightStorage();
  storage.database = async () => db;
  const old = createRecordedFlight({ id: "old", startedAt: 1_000 });
  await storage.saveActiveFlight(old);
  await assert.rejects(storage.saveActiveFlight(createRecordedFlight({ id: "new" })));
  assert.equal(db.read("activeFlight", "current").flight.id, "old");
  db.abortNext();
  await assert.rejects(storage.completeFlight(finalizeRecordedFlight(old, 61_000)));
  assert.equal(db.read("activeFlight", "current").flight.status, "RECORDING");
  assert.equal(db.read("flights", "old"), undefined);
  // Late enrichment/import of another flight cannot clear the ongoing one.
  await storage.completeFlight(finalizeRecordedFlight(createRecordedFlight({ id: "other" })));
  assert.equal(db.read("activeFlight", "current").flight.id, "old");
});

test("backfill existant réenfile un vol terminé dont l'enqueue initial avait échoué", async () => {
  const outbox = new MemorySyncOutboxStorage();
  const service = new CloudBackfillService({
    scope: "USER:pilot", getScope: () => "USER:pilot", isOnline: () => true,
    getOnlineUserId: async () => "pilot", listCandidates: async () => [{ entityType: "flight", entityId: "local" }],
    findExistingCloud: async () => new Set(), outbox,
  });
  assert.equal((await service.run()).enqueued, 1);
  assert.equal((await service.run()).pendingPreserved, 1);
  assert.equal((await outbox.list()).length, 1);
});

test("un échec de projection Journal après commit ne fait pas échouer la fin", async (t) => {
  const h = await tracking(t, undefined, {
    "../lib/flightCompletionStorage": {
      persistRecordedFlightInJournal() { throw new Error("Journal unavailable"); },
      enrichJournalFlightLocations() {},
    },
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await h.current.startTracking(point());
  assert.ok(await h.render().stopTracking());
  assert.equal(h.render().status, "stopped");
  assert.equal(await h.storage.getActiveFlight(), null);
});

test("enrichissement tardif : préserve notes et nouveau vol actif, ne ressuscite pas une suppression", async () => {
  const { IndexedDbRecordedFlightStorage } = loadModule("./recordedFlightStorage.ts", {
    "./auth/dataScopeRuntime.ts": { getRuntimeDataScope: () => "GUEST" },
    "./syncOutbox.ts": { enqueueLocalSyncMutation: async () => true },
  });
  const db = database();
  const storage = new IndexedDbRecordedFlightStorage();
  storage.database = async () => db;
  const completed = { ...finalizeRecordedFlight(createRecordedFlight({ id: "old" })), notes: "Saisi pendant la requête" };
  await storage.completeFlight(completed);
  await storage.saveActiveFlight(createRecordedFlight({ id: "new" }));
  const updated = await storage.updateFlightLocations("old", { startLocationLabel: "Départ", endLocationLabel: "Arrivée", generatedTitle: "Départ → Arrivée" });
  assert.equal(updated.notes, completed.notes);
  assert.deepEqual(updated.points, completed.points);
  assert.equal(updated.endedAt, completed.endedAt);
  assert.equal(db.read("activeFlight", "current").flight.id, "new");
  assert.equal(await storage.updateFlightLocations("deleted", { startLocationLabel: "Départ" }), null);
  assert.equal(db.read("flights", "deleted"), undefined);
});

test("compatibilité legacy : un vol terminé n'est jamais réécrit dans activeFlight", async (t) => {
  const storage = new MemoryRecordedFlightStorage();
  let writes = 0;
  storage.saveActiveFlight = async () => { writes++; throw new Error("Unexpected active write"); };
  const h = await tracking(t, storage, {
    "../lib/flightSessionStorage": { loadFlightSession: () => ({
      version: 1, status: "stopped", startTime: 1_000, savedAt: 61_000,
      points: [point(1_000), point(61_000)],
    }) },
  });
  assert.equal(writes, 0);
  assert.equal(h.current.completedFlight.endedAt, 61_000);
  assert.equal((await storage.listFlights()).length, 1);
  assert.equal(await storage.getActiveFlight(), null);
});
