import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/geocoding/reverse/route.ts";
import { resolveRecordedFlightLocations } from "./flightLocationResolver.ts";
import { REVERSE_GEOCODING_GAP_MS, REVERSE_GEOCODING_TIMEOUT_MS } from "./reverseGeocoding.ts";
import { enrichRecordedFlightLocations, retryIncompleteFlightLocations } from "./flightLocationEnrichment.ts";
import { IndexedDbRecordedFlightStorage, MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { createRecordedFlight } from "./recordedFlight.ts";
import { persistRecordedFlightInJournal, loadFlightCompletionState, saveFlightCompletionState } from "./flightCompletionStorage.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function flight() {
  return { ...createRecordedFlight({ id: "places", startedAt: 1 }), status: "COMPLETED", endedAt: 2,
    points: [{ timestamp: 1, latitude: 50, longitude: 3 }, { timestamp: 2, latitude: 51, longitude: 4 }],
    startLocationLabel: "Départ inconnu", endLocationLabel: "Arrivée inconnue" };
}
function browser(t) {
  const values = new Map(); let fail = false;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error("Quota exceeded"); values.set(key, value); }, removeItem: key => values.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage: storage }); globalThis.localStorage = storage;
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; setRuntimeGuestModeActive(false); });
  return { fail: value => { fail = value; } };
}

for (const failed of ["start", "end"]) test(`API : échec ${failed}, l'autre nom est conservé`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const place = ++calls === 1 ? "start" : "end";
    if (place === failed) throw new Error("Geocoder failure");
    return Response.json({ address: { city: place === "start" ? "Bondues" : "Mérignies" } });
  });
  const result = POST(new Request("https://bc.test/api/geocoding/reverse", { method: "POST", body: JSON.stringify({ start: { latitude: 50, longitude: 3 }, end: { latitude: 51, longitude: 4 } }) }));
  await flush(); t.mock.timers.tick(REVERSE_GEOCODING_GAP_MS); await flush();
  const response = await result;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body[failed === "start" ? "endLocationLabel" : "startLocationLabel"], failed === "start" ? "Mérignies" : "Bondues");
  assert.equal(calls, 2);
});

test("timeout serveur sur l'arrivée : le client reçoit encore le départ réussi", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ address: { city: "Bondues" } }) : new Promise(() => {}));
  const resolving = resolveRecordedFlightLocations(flight(), undefined, (_url, options) => POST(new Request("https://bc.test/api/geocoding/reverse", options)));
  await flush(); t.mock.timers.tick(REVERSE_GEOCODING_GAP_MS); await flush();
  t.mock.timers.tick(REVERSE_GEOCODING_TIMEOUT_MS); await flush();
  const result = await resolving;
  assert.equal(result.startLocationLabel, "Bondues");
  assert.equal(result.endLocationLabel, "Arrivée inconnue");
});

test("retry après offline : noms persistés, tous les champs Journal alignés, notes conservées", async t => {
  browser(t); const storage = new MemoryRecordedFlightStorage(); const original = flight();
  await storage.completeFlight(original); persistRecordedFlightInJournal(original);
  const before = loadFlightCompletionState(); before.journalFlights[0].notes = "Note pilote"; before.journalFlights[0].customTitle = "Mon titre"; saveFlightCompletionState(before);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await enrichRecordedFlightLocations(original, storage);
  t.mock.method(globalThis, "fetch", async () => Response.json({ startLocationLabel: "Bondues", endLocationLabel: "Mérignies" }));
  await enrichRecordedFlightLocations(original, storage);
  const saved = await storage.getFlight(original.id), journal = loadFlightCompletionState().journalFlights[0];
  assert.equal(saved.startLocationLabel, "Bondues"); assert.equal(saved.endLocationLabel, "Mérignies");
  assert.equal(journal.departure, "Bondues"); assert.equal(journal.startLocationLabel, "Bondues");
  assert.equal(journal.arrival, "Mérignies"); assert.equal(journal.endLocationLabel, "Mérignies");
  assert.equal(journal.notes, "Note pilote"); assert.equal(journal.customTitle, "Mon titre");
});

test("échec de sauvegarde Journal remonté ; nouvelle tentative sans refaire le geocoding", async t => {
  const b = browser(t), storage = new MemoryRecordedFlightStorage(), original = flight();
  await storage.completeFlight(original); persistRecordedFlightInJournal(original);
  t.mock.method(globalThis, "fetch", async () => Response.json({ startLocationLabel: "Bondues", endLocationLabel: "Mérignies" }));
  b.fail(true);
  await assert.rejects(enrichRecordedFlightLocations(original, storage), /sauvegarde dans le Journal/);
  assert.equal((await storage.getFlight(original.id)).endLocationLabel, "Mérignies");
  b.fail(false);
  t.mock.method(globalThis, "fetch", async () => assert.fail("Pas de nouvelle requête pour les lieux connus"));
  await enrichRecordedFlightLocations(original, storage);
  assert.equal(loadFlightCompletionState().journalFlights[0].endLocationLabel, "Mérignies");
});

test("tentatives concurrentes : un seul enrichissement ; changement de compte : aucune écriture tardive", async t => {
  browser(t); const storage = new MemoryRecordedFlightStorage(), original = flight();
  await storage.completeFlight(original); persistRecordedFlightInJournal(original);
  let release; const network = new Promise(resolve => { release = resolve; });
  let calls = 0; const resolver = async () => { calls++; return network; };
  const one = enrichRecordedFlightLocations(original, storage, undefined, resolver);
  const two = enrichRecordedFlightLocations(original, storage, undefined, resolver);
  assert.equal(one, two); await flush(); assert.equal(calls, 1);
  setRuntimeGuestModeActive(false);
  release({ ...original, startLocationLabel: "Bondues", endLocationLabel: "Mérignies" });
  assert.equal(await one, null);
  assert.equal((await storage.getFlight(original.id)).startLocationLabel, "Départ inconnu");
});


test("retour réseau : scan des vols terminés, un seul passage et seulement l'arrivée inconnue", async t => {
  browser(t); t.mock.timers.enable({ apis: ["setTimeout"] });
  const prior = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const connection = { onLine: false };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: connection });
  t.after(() => prior ? Object.defineProperty(globalThis, "navigator", prior) : delete globalThis.navigator);
  const memory = new MemoryRecordedFlightStorage(), original = { ...flight(), startLocationLabel: "Bondues" };
  await memory.completeFlight(original); persistRecordedFlightInJournal(original);
  let scans = 0, calls = 0;
  t.mock.method(IndexedDbRecordedFlightStorage.prototype, "listFlights", async () => { scans++; return [original, { ...original, id: "active", status: "RECORDING" }]; });
  t.mock.method(IndexedDbRecordedFlightStorage.prototype, "getFlight", id => memory.getFlight(id));
  t.mock.method(IndexedDbRecordedFlightStorage.prototype, "updateFlightLocations", (id, labels) => memory.updateFlightLocations(id, labels));
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++; assert.equal(JSON.parse(options.body).start, undefined);
    return Response.json({ endLocationLabel: "Mérignies" });
  });
  await retryIncompleteFlightLocations(); assert.equal(scans, 0);
  connection.onLine = true;
  const one = retryIncompleteFlightLocations(), two = retryIncompleteFlightLocations();
  assert.equal(one, two);
  await flush(); t.mock.timers.tick(REVERSE_GEOCODING_GAP_MS); await flush(); await one;
  assert.equal(scans, 1); assert.equal(calls, 1);
  assert.equal(loadFlightCompletionState().journalFlights[0].arrival, "Mérignies");
});

test("le composant déclenche la reprise à l'ouverture, online et retour visible, puis nettoie ses listeners", async t => {
  browser(t);
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => prior ? Object.defineProperty(globalThis, "document", prior) : delete globalThis.document);
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const source = readFileSync(new URL("../components/FlightLocationRetry.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let calls = 0, cleanup;
  const exports = {};
  new Function("require", "exports", js)(id => {
    if (id === "react") return { useEffect: fn => { cleanup = fn(); } };
    if (id.includes("flightLocationEnrichment")) return { retryIncompleteFlightLocations: async () => { calls++; } };
    return { DATA_SCOPE_CHANGED_EVENT: "scope-change" };
  }, exports);
  exports.default(); assert.equal(calls, 1);
  window.dispatchEvent(new Event("online")); assert.equal(calls, 2);
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); assert.equal(calls, 2);
  doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); assert.equal(calls, 3);
  window.dispatchEvent(new Event("scope-change")); assert.equal(calls, 4);
  cleanup(); window.dispatchEvent(new Event("online")); assert.equal(calls, 4);
});
