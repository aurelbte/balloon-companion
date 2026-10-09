import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFlightTrackDebugSnapshot, readExistingDebugStore } from "./flightTrackDebugSnapshot.ts";

function factory(stores, { upgrade = false, fail = false } = {}) {
  const calls = [];
  return { calls,
    databases: async () => Object.keys(stores).map(name => ({ name })),
    open(name, ...args) {
      calls.push(["open", name, ...args]);
      assert.equal(args.length, 0, "no version upgrade requested");
      const request = { transaction: { abort() { calls.push(["abort"]); queueMicrotask(() => request.onerror()); } } };
      request.result = {
        close() { calls.push(["close"]); },
        objectStoreNames: { contains: () => true },
        transaction(store, mode) {
          assert.equal(mode, "readonly"); calls.push(["transaction", store, mode]);
          const transaction = { objectStore: () => ({ getAll() {
            calls.push(["getAll"]);
            const read = { result: stores[name] };
            queueMicrotask(() => fail ? transaction.onerror() : transaction.oncomplete());
            return read;
          } }) };
          return transaction;
        },
      };
      queueMicrotask(() => upgrade ? request.onupgradeneeded() : request.onsuccess());
      return request;
    },
  };
}
function fixture() {
  const id = "12345678-secret-flight-id";
  const scope = "USER:private-user";
  const stores = {
    "balloon-companion-flights": [
      { id, status: "COMPLETED", points: [{ latitude: 51.123456, longitude: 3.98765 }], name: "Private Pilot", notes: "private notes" },
      { id: "empty", status: "COMPLETED", points: [] },
      { id: "active", status: "RECORDING", points: [{}] },
    ],
    "balloon-companion-flight-track-queue-v1": [
      { flightId: id, scope, userId: "private-user", operation: "UPLOAD", status: "FAILED", attempts: 2, lastErrorCode: "R2_ENDPOINT_500", lastErrorCategory: "SERVER", nextEligibleRetryAt: "2026-10-09T10:00:00.000Z", objectKey: "users/private-user/full-key", checksum: "private-checksum" },
      { flightId: id, scope: "USER:other", userId: "other", operation: "DELETE" },
    ],
  };
  const db = factory(stores);
  const input = {
    factory: db, getScope: () => scope, getGeneration: () => 1, databaseName: (_scope, name) => name,
    getRuntime: () => ({ scope, online: true, active: true, bootstrapInProgress: false, pushInProgress: false,
      lastPushAuthorized: false, lastPushExecuted: false, lastPushState: "STOPPED_ERROR", lastPushRefusalReason: "BOOTSTRAP_BLOCKED",
      lastError: { code: "PUSH_STOPPED_ERROR", message: "private payload" }, history: [{ userId: "private-user" }] }),
    getDiscovery: () => ({ known: true, complete: false, generation: 3, downloadsChecked: false, discoveryError: "TRACE_DISCOVERY_FAILED", active: false }),
    getGate: () => ({ controlledMode: false, localDataReady: true, localCollisionCount: 1 }),
  };
  return { input, db, stores, id };
}

test("snapshot limité aux vols terminés avec points, jobs associés et état runtime expurgé", async () => {
  const { input, db, id } = fixture();
  const result = await getFlightTrackDebugSnapshot(input);
  assert.equal(result.flights.length, 1);
  assert.equal(result.flights[0].flightId, "12345678…");
  assert.equal(result.flights[0].pointCount, 1);
  assert.equal(result.flights[0].jobs.length, 1);
  assert.equal(result.flights[0].jobs[0].lastErrorCode, "R2_ENDPOINT_500");
  assert.equal(result.runtime.lastPushRefusalReason, "BOOTSTRAP_BLOCKED");
  assert.equal(result.discovery.error, "TRACE_DISCOVERY_FAILED");
  assert.equal(result.flights[0].remote.knowledge, "UNKNOWN_NOT_CACHED");
  assert.equal(result.flights[0].remote.has_object_key, null);
  const json = JSON.stringify(result);
  for (const secret of [id, "private-user", "Private Pilot", "private notes", "51.123456", "3.98765", "full-key", "private-checksum", "private payload"]) assert.ok(!json.includes(secret), secret);
  assert.equal(db.calls.filter(([op]) => op === "transaction").length, 2);
  assert.equal(db.calls.filter(([op]) => op === "close").length, 2);
});

test("base absente ou énumération indisponible : aucun open susceptible de créer une base", async () => {
  const db = factory({});
  assert.equal((await readExistingDebugStore(db, "absent", "flights")).state, "ABSENT");
  assert.equal((await readExistingDebugStore({ open() { assert.fail(); } }, "absent", "flights")).state, "UNAVAILABLE");
  assert.deepEqual(db.calls, []);
});

test("course suppression de base : upgrade annulé sans créer de store", async () => {
  const db = factory({ flights: [] }, { upgrade: true });
  assert.equal((await readExistingDebugStore(db, "flights", "flights")).state, "UNAVAILABLE");
  assert.ok(db.calls.some(([op]) => op === "abort"));
  assert.ok(!db.calls.some(([op]) => op === "transaction"));
});

test("erreur de lecture et changement de compte ne divulguent aucun contenu", async () => {
  const { input, stores } = fixture();
  input.factory = factory(stores, { fail: true });
  assert.equal((await getFlightTrackDebugSnapshot(input)).state, "PARTIAL");
  input.factory = factory(stores);
  let generation = 0; input.getGeneration = () => generation++;
  assert.deepEqual(await getFlightTrackDebugSnapshot(input), { state: "SCOPE_CHANGED", flights: [] });
});

test("helper isolé sans transport, écriture ou mutation du runtime ; exposé en production et nettoyé", () => {
  const helper = readFileSync(new URL("./flightTrackDebugSnapshot.ts", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /fetch\(|createBrowserSupabase|readwrite|createObjectStore|\.put\(|\.delete\(|localStorage|dispatchEvent|enqueue|\.upload\(|\.download\(/);
  const component = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  const effect = component.slice(component.indexOf("// Temporary observer"), component.indexOf("const releaseRuntimeMount = acquireRuntimeMount()", component.indexOf("// Temporary observer")));
  assert.match(effect, /window.getFlightTrackDebugSnapshot = flightTrackDebug/);
  assert.match(effect, /delete window.getFlightTrackDebugSnapshot/);
  assert.doesNotMatch(effect, /NODE_ENV|\.setUser\(|synchronizeNow|\.inspect\(flightId\)/);
});
