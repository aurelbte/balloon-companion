import assert from "node:assert/strict";
import test from "node:test";
import { CloudSyncService, CloudSyncTransportError, MemoryCloudSyncIssueRepository } from "./cloudSyncService.ts";
import { BrowserCloudSyncPayloadProvider } from "./cloudSyncBrowser.ts";
import { MemorySyncOutboxStorage, IndexedDbSyncOutboxStorage } from "./syncOutbox.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fixture(input = {}) {
  let sequence = 0, time = Date.parse("2026-09-16T12:00:00Z"), cloud = null, revision = 0, builds = 0;
  const values = new Map(), receipts = new Map(), requests = [];
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const outbox = input.outbox ?? new MemorySyncOutboxStorage({ dependencies: { createId: () => `mutation-${++sequence}`, now: () => new Date(time).toISOString() } });
  const provider = new BrowserCloudSyncPayloadProvider(localStorage, scope);
  const issues = new MemoryCloudSyncIssueRepository();
  const service = new CloudSyncService({
    outbox, issues, getScope: () => scope, getOnlineUserId: async () => scope.slice(5), now: () => new Date(time),
    buildPayload: async (mutation) => {
      builds++;
      const payload = await provider.build(mutation);
      if (input.prepare) await input.prepare(payload, mutation);
      return payload;
    },
    applyMutation: async (request) => {
      requests.push(structuredClone(request));
      if (input.send) await input.send(request);
      const replay = receipts.get(request.mutationId);
      if (replay) return { ...replay, status: "ALREADY_APPLIED" };
      if (request.baseRevision !== revision || input.conflict) return { status: "CONFLICT", entityId: request.entityId, revision, serverUpdatedAt: new Date(time).toISOString(), deletedAt: null };
      cloud = request.operation === "DELETE" ? null : request.payload.first_name;
      revision++;
      const response = { status: "APPLIED", entityId: request.entityId, revision, serverUpdatedAt: new Date(time).toISOString(), deletedAt: request.operation === "DELETE" ? new Date(time).toISOString() : null };
      receipts.set(request.mutationId, response);
      if (input.afterCommit) await input.afterCommit(request);
      return response;
    },
  });
  return {
    outbox, service, issues, requests, localStorage,
    cloud: () => cloud, builds: () => builds,
    local: () => JSON.parse(localStorage.getItem(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY))).firstName,
    advance(ms = 60_000) { time += ms; },
    async edit(firstName, operation = "UPSERT") {
      localStorage.setItem(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY), JSON.stringify({ firstName, lastName: "Pilote" }));
      return outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation });
    },
  };
}

for (const window of ["prepare", "send"]) test(`A → B pendant ${window} : acquittement A conserve B pending, passe suivante applique B`, async () => {
  const reached = deferred(), release = deferred(); let once = true;
  const f = fixture({ [window]: async () => { if (once) { once = false; reached.resolve(); await release.promise; } } });
  const original = await f.edit("A");
  const pass = f.service.syncPendingMutations();
  await reached.promise;
  const successor = await f.edit("B");
  release.resolve();
  const first = await pass;
  assert.equal(f.local(), "B");
  assert.equal(f.cloud(), "A");
  const pending = await f.outbox.list();
  assert.equal(pending.length, 1);
  assert.notEqual(successor.mutationId, original.mutationId);
  assert.equal(pending[0].mutationId, successor.mutationId);
  assert.equal(pending[0].attempts, 0);
  assert.equal(pending[0].baseRevision, 1);
  assert.equal(first.state, "PENDING");
  assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.equal(f.local(), "B"); assert.equal(f.cloud(), "B");
  assert.deepEqual(await f.outbox.list(), []);
  assert.deepEqual(f.requests.map((r) => r.payload.first_name), ["A", "B"]);
});

test("sans modification concurrente : une seule requête et aucun pending", async () => {
  const f = fixture(); await f.edit("A");
  assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.equal(f.cloud(), "A"); assert.equal(f.local(), "A");
  assert.equal(f.requests.length, 1); assert.deepEqual(await f.outbox.list(), []);
});

for (const window of ["prepare", "send"]) test(`modifications rapides B/C/D pendant ${window} : D reste représenté`, async () => {
  const reached = deferred(), release = deferred(); let once = true;
  const f = fixture({ [window]: async () => { if (once) { once = false; reached.resolve(); await release.promise; } } });
  const a = await f.edit("A"); const pass = f.service.syncPendingMutations(); await reached.promise;
  const edits = await Promise.all([f.edit("B"), f.edit("C"), f.edit("D")]); release.resolve();
  assert.equal((await pass).state, "PENDING");
  const pending = await f.outbox.list();
  assert.equal(pending.length, 1); assert.notEqual(pending[0].mutationId, a.mutationId);
  assert.ok(edits.every((edit) => edit.mutationId === pending[0].mutationId));
  assert.equal(f.local(), "D"); assert.equal(f.cloud(), "A");
  assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.equal(f.cloud(), "D"); assert.deepEqual(await f.outbox.list(), []);
});

for (const failureWindow of ["send", "afterCommit"]) test(`retry après échec ${failureWindow} : même identifiant et payload A, puis B`, async () => {
  let failed = false, f;
  f = fixture({ [failureWindow]: async () => {
    if (!failed) { failed = true; await f.edit("B"); throw new CloudSyncTransportError("NETWORK", "offline"); }
  } });
  const a = await f.edit("A");
  assert.equal((await f.service.syncPendingMutations()).state, "STOPPED_ERROR");
  assert.equal(f.local(), "B"); assert.equal(f.cloud(), failureWindow === "send" ? null : "A");
  const pending = await f.outbox.list(); assert.equal(pending.length, 2);
  assert.equal(pending[0].lastErrorCode, "NETWORK");
  assert.equal(pending[0].payloadSnapshot.payload.first_name, "A");
  assert.equal((await f.service.syncMutationById(a.mutationId)).state, "PENDING");
  assert.equal(f.requests.length, 1); // Backoff is still enforced.
  f.advance(); assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.deepEqual(f.requests.map((request) => request.payload.first_name), ["A", "A", "B"]);
  assert.equal(f.requests[0].mutationId, f.requests[1].mutationId);
  assert.equal(f.requests[2].baseRevision, 1); assert.equal(f.builds(), 2);
  assert.equal(f.local(), "B"); assert.equal(f.cloud(), "B"); assert.deepEqual(await f.outbox.list(), []);
});

test("conflit A : B local et les deux mutations restent conservés", async () => {
  let f; f = fixture({ conflict: true, send: async () => { await f.edit("B"); } });
  await f.edit("A"); const result = await f.service.syncPendingMutations();
  assert.equal(result.conflicts, 1); assert.equal(result.state, "PENDING");
  const pending = await f.outbox.list(); assert.equal(pending.length, 2);
  assert.equal(pending[0].lastErrorCode, "CONFLICT"); assert.equal(pending[1].attempts, 0);
  assert.equal(f.local(), "B"); assert.equal(f.cloud(), null);
  assert.equal((await f.issues.list()).length, 1);
});

test("un DELETE pendant l’envoi A garde son tombstone et utilise la révision acquittée", async () => {
  let once = true, f, localMetadata;
  f = fixture({ send: async () => { if (once) {
    once = false; f.advance(); await f.edit("B", "DELETE");
    localMetadata = await f.outbox.getMetadata("pilot-profile", "singleton");
  } } });
  await f.edit("A"); assert.equal((await f.service.syncPendingMutations()).state, "PENDING");
  const metadata = await f.outbox.getMetadata("pilot-profile", "singleton");
  assert.equal(metadata.deletedAt, localMetadata.deletedAt); assert.equal(metadata.updatedAt, localMetadata.updatedAt);
  assert.equal(metadata.revision, 1);
  assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.equal(f.requests[1].operation, "DELETE"); assert.equal(f.requests[1].baseRevision, 1);
  assert.equal(f.cloud(), null); assert.deepEqual(await f.outbox.list(), []);
});

test("le snapshot survit à une nouvelle instance et reste détaché du payload du fournisseur", async () => {
  let source, once = true;
  const f = fixture({ prepare: (payload) => { source = payload; }, send: async () => {
    if (once) { once = false; source.payload.first_name = "CORRUPTED"; throw new CloudSyncTransportError("NETWORK", "offline"); }
  } });
  await f.edit("A"); await f.service.syncPendingMutations(); await f.edit("B");
  const resumed = new CloudSyncService({ outbox: f.outbox, issues: f.issues,
    getScope: () => scope, getOnlineUserId: async () => scope.slice(5), now: () => new Date("2026-09-16T13:00:00Z"),
    buildPayload: async () => { throw new Error("Must reuse the persisted snapshot"); },
    applyMutation: async (request) => {
      assert.equal(request.payload.first_name, "A");
      return { status: "APPLIED", entityId: request.entityId, revision: 1, serverUpdatedAt: "2026-09-16T13:00:00Z", deletedAt: null };
    },
  });
  const original = (await f.outbox.list())[0];
  assert.equal((await resumed.syncMutationById(original.mutationId)).state, "PENDING");
  assert.equal((await f.outbox.list()).length, 1); assert.equal(f.local(), "B");
});

// Serial, transactional IDB double: request handlers may enqueue writes, and an
// abort discards every write. Transactions sharing stores cannot interleave.
function transactionalDatabase() {
  let stores = new Map(["mutations", "metadata"].map((name) => [name, new Map()]));
  const transactions = []; let busy = false;
  const database = {
    onGetAll: null, abortNext: false,
    transaction(names, mode) {
      const operations = []; let working, aborted = false;
      const tx = {
        error: null, abort() { aborted = true; tx.error = new Error("transaction aborted"); },
        objectStore(name) {
          const request = (operation) => { const result = {}; operations.push(() => {
            result.result = operation(working.get(name));
            result.onsuccess?.();
          }); return result; };
          return {
            get: (key) => request((store) => structuredClone(store.get(JSON.stringify(key)))),
            getAll: () => request((store) => { const values = structuredClone([...store.values()]); database.onGetAll?.(); return values; }),
            put(value) { const copy = structuredClone(value); return request((store) => store.set(JSON.stringify(name === "mutations" ? copy.mutationId : [copy.entityType, copy.entityId]), copy)); },
            delete: (key) => request((store) => store.delete(JSON.stringify(key))),
          };
        },
      };
      transactions.push(() => {
        working = structuredClone(stores);
        const abortAtCommit = mode === "readwrite" && database.abortNext;
        if (abortAtCommit) database.abortNext = false;
        const step = () => {
          if (!aborted && operations.length) { operations.shift()(); queueMicrotask(step); return; }
          if (abortAtCommit) tx.abort();
          if (aborted) tx.onabort?.();
          else { if (mode === "readwrite") stores = working; tx.oncomplete?.(); }
          busy = false; start();
        };
        queueMicrotask(step);
      });
      queueMicrotask(start); return tx;
    },
  };
  function start() { if (!busy && transactions.length) { busy = true; transactions.shift()(); } }
  return database;
}

function indexedOutbox(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {} });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; });
  const database = transactionalDatabase(), outbox = new IndexedDbSyncOutboxStorage(scope);
  outbox.databasePromise = Promise.resolve(database);
  return { database, outbox };
}

test("IndexedDB : A en préparation, B concurrent, acquittement atomique et envoi B", async (t) => {
  const { outbox } = indexedOutbox(t); const reached = deferred(), release = deferred(); let once = true;
  const f = fixture({ outbox, prepare: async () => { if (once) { once = false; reached.resolve(); await release.promise; } } });
  await f.edit("A"); const pass = f.service.syncPendingMutations(); await reached.promise;
  await f.edit("B"); release.resolve(); assert.equal((await pass).state, "PENDING");
  assert.equal(f.local(), "B"); assert.equal(f.cloud(), "A");
  const pending = await outbox.list(); assert.equal(pending.length, 1); assert.equal(pending[0].baseRevision, 1);
  assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.equal(f.cloud(), "B"); assert.deepEqual(await outbox.list(), []);
});

test("IndexedDB : enqueue concurrent à la réservation ne réécrit jamais attempts avec une lecture périmée", async (t) => {
  const { database, outbox } = indexedOutbox(t);
  const a = await outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  let claim;
  database.onGetAll = () => { database.onGetAll = null; claim = outbox.markAttempt(a.mutationId); };
  await outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "DELETE" });
  const reserved = await claim, stored = (await outbox.list()).find((mutation) => mutation.mutationId === a.mutationId);
  assert.deepEqual(stored, reserved); assert.equal(stored.attempts, 1);
  assert.equal(stored.operation, "DELETE");
});

test("IndexedDB : rollback de l’acquittement conserve A, B et les métadonnées ; replay réussit", async (t) => {
  const { database, outbox } = indexedOutbox(t); let once = true, f;
  f = fixture({ outbox, send: async () => { if (once) { once = false; await f.edit("B"); database.abortNext = true; } } });
  await f.edit("A"); assert.equal((await f.service.syncPendingMutations()).state, "STOPPED_ERROR");
  assert.equal(f.cloud(), "A"); assert.equal(f.local(), "B");
  assert.equal((await outbox.list()).length, 2);
  assert.equal((await outbox.getMetadata("pilot-profile", "singleton")).revision, 0);
  f.advance(); assert.equal((await f.service.syncPendingMutations()).state, "COMPLETED");
  assert.deepEqual(f.requests.map((request) => request.payload.first_name), ["A", "A", "B"]);
  assert.equal(f.cloud(), "B"); assert.deepEqual(await outbox.list(), []);
});
