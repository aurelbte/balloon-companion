import test from "node:test";
import assert from "node:assert/strict";

import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { createInitialSyncMetadata } from "./syncMetadata.ts";
import { scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import { SYNC_OUTBOX_DB_NAME } from "./syncOutbox.ts";

function deterministicStorage(shared = {}) {
  let sequence = 0;
  return new MemorySyncOutboxStorage({
    mutations: shared.mutations,
    metadata: shared.metadata,
    dependencies: {
      createId: () => `mutation-${++sequence}`,
      now: () => "2026-08-18T10:00:00.000Z",
    },
  });
}

test("crée et persiste une mutation minimale sans payload ni Blob", async () => {
  const shared = { mutations: new Map(), metadata: new Map() };
  const first = deterministicStorage(shared);
  const mutation = await first.enqueue({ entityType: "recorded-flight", entityId: "flight-1", operation: "UPSERT" });
  const reopened = deterministicStorage(shared);
  assert.deepEqual(await reopened.list(), [mutation]);
  assert.equal("payload" in mutation, false);
  assert.equal(Object.values(mutation).some((value) => value instanceof Blob), false);
});

test("les stockages USER A, USER B et GUEST restent isolés", async () => {
  const userA = deterministicStorage();
  const userB = deterministicStorage();
  const guest = deterministicStorage();
  await userA.enqueue({ entityType: "profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await userA.list()).length, 1);
  assert.equal((await userB.list()).length, 0);
  assert.equal((await guest.list()).length, 0);
  assert.notEqual(scopedIndexedDbName("USER:user-a", SYNC_OUTBOX_DB_NAME), scopedIndexedDbName("USER:user-b", SYNC_OUTBOX_DB_NAME));
  assert.notEqual(scopedIndexedDbName("USER:user-a", SYNC_OUTBOX_DB_NAME), scopedIndexedDbName("GUEST", SYNC_OUTBOX_DB_NAME));
});

test("UPSERT puis UPSERT coalesce en conservant mutationId", async () => {
  const storage = deterministicStorage();
  const first = await storage.enqueue({ entityType: "flight", entityId: "f1", operation: "UPSERT" });
  const second = await storage.enqueue({ entityType: "flight", entityId: "f1", operation: "UPSERT" });
  assert.equal(second.mutationId, first.mutationId);
  assert.equal((await storage.list()).length, 1);
});

test("DELETE remplace un UPSERT non tenté et crée un tombstone", async () => {
  const storage = deterministicStorage();
  const first = await storage.enqueue({ entityType: "document", entityId: "d1", operation: "UPSERT" });
  const deleted = await storage.enqueue({ entityType: "document", entityId: "d1", operation: "DELETE" });
  assert.equal(deleted.mutationId, first.mutationId);
  assert.equal(deleted.operation, "DELETE");
  assert.equal((await storage.getMetadata("document", "d1"))?.deletedAt, "2026-08-18T10:00:00.000Z");
});

test("un DELETE A ne bloque pas la fusion immédiate de l’UPSERT B en DELETE B", async () => {
  const storage = deterministicStorage();
  await storage.enqueue({ entityType: "flight", entityId: "A", operation: "DELETE" });
  const upsertB = await storage.enqueue({ entityType: "flight", entityId: "B", operation: "UPSERT" });
  const deleteB = await storage.enqueue({ entityType: "flight", entityId: "B", operation: "DELETE" });
  const mutations = await storage.list();

  assert.equal(deleteB.mutationId, upsertB.mutationId);
  assert.deepEqual(mutations.map(({ entityId, operation }) => ({ entityId, operation })), [
    { entityId: "A", operation: "DELETE" },
    { entityId: "B", operation: "DELETE" },
  ]);
});

test("un retry conserve mutationId, incrémente attempts puis peut être supprimé", async () => {
  const storage = deterministicStorage();
  const mutation = await storage.enqueue({ entityType: "balloon", entityId: "b1", operation: "UPSERT" });
  const retried = await storage.markAttempt(mutation.mutationId, { nextAttemptAt: "2026-08-18T10:01:00.000Z", lastErrorCode: "OFFLINE" });
  assert.equal(retried?.mutationId, mutation.mutationId);
  assert.equal(retried?.attempts, 1);
  await storage.remove(mutation.mutationId);
  assert.deepEqual(await storage.list(), []);
});

test("une mutation après tentative n'est pas coalescée avec l'opération incertaine", async () => {
  const storage = deterministicStorage();
  const first = await storage.enqueue({ entityType: "note", entityId: "f1", operation: "UPSERT" });
  await storage.markAttempt(first.mutationId);
  const second = await storage.enqueue({ entityType: "note", entityId: "f1", operation: "UPSERT" });
  assert.notEqual(second.mutationId, first.mutationId);
  assert.equal((await storage.list()).length, 2);
});

test("les métadonnées legacy commencent à revision zéro en UTC", () => {
  assert.deepEqual(createInitialSyncMetadata("2026-08-18T10:00:00.000Z"), {
    revision: 0,
    updatedAt: "2026-08-18T10:00:00.000Z",
  });
});

test("removeMany retire atomiquement la sélection logique sans toucher aux autres", async () => {
  const storage = deterministicStorage();
  const first = await storage.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
  await storage.markAttempt(first.mutationId);
  const second = await storage.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
  const other = await storage.enqueue({ entityType: "flight", entityId: "flight-a", operation: "UPSERT" });
  await storage.removeMany([first.mutationId, second.mutationId]);
  assert.deepEqual((await storage.list()).map(({ mutationId }) => mutationId), [other.mutationId]);
});

test("listMetadata inventorie les sidecars sans les modifier", async () => {
  const storage = deterministicStorage();
  await storage.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
  await storage.enqueue({ entityType: "flight", entityId: "flight-a", operation: "DELETE" });
  const before = await storage.listMetadata();
  const after = await storage.listMetadata();
  assert.deepEqual(after, before);
  assert.deepEqual(before.map(({ entityType, entityId, revision }) => ({ entityType, entityId, revision })), [
    { entityType: "flight", entityId: "flight-a", revision: 0 },
    { entityType: "weather-preferences", entityId: "singleton", revision: 0 },
  ]);
});
