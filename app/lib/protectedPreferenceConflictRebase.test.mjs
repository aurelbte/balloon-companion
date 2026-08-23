import test from "node:test";
import assert from "node:assert/strict";
import {
  ProtectedPreferenceConflictRebaseError,
  resolveProtectedPreferenceConflictLocalWins,
} from "./protectedPreferenceConflictRebase.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture(input = {}) {
  let nextId = 1;
  const outbox = new MemorySyncOutboxStorage({ dependencies: {
    createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => `2026-08-24T10:00:0${nextId}.000Z`,
  } });
  let currentScope = scope;
  const type = input.type ?? "weather-preferences";
  const historicalIds = [];
  for (let index = 0; index < (input.historicalCount ?? 2); index += 1) {
    const mutation = await outbox.enqueue({ entityType: type, entityId: "singleton", operation: "UPSERT" });
    await outbox.markAttempt(mutation.mutationId);
    await outbox.updateMutation(mutation.mutationId, { lastErrorCode: "CONFLICT" });
    historicalIds.push(mutation.mutationId);
  }
  const cloud = input.cloud === undefined
    ? { revision: 1, updatedAt: "2026-08-24T09:00:00.000Z", deletedAt: null }
    : input.cloud;
  const dependencies = {
    outbox,
    getScope: () => currentScope,
    readCloudState: async () => {
      if (input.readError) throw new Error("offline");
      if (input.switchDuringRead) currentScope = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      return cloud;
    },
    buildPayload: async () => input.invalidPayload ? null : ({
      serverEntityType: type === "aviation-preferences" ? "aviation_preferences" : "user_preferences",
      serverEntityId: type === "aviation-preferences" ? "aviation" : type === "unit-preferences" ? "units" : "weather",
      payload: type === "aviation-preferences" ? { favorites: [] } : { preferences: { test: true } },
    }),
    syncMutationById: async (mutationId) => {
      if (input.syncError) throw new Error("network");
      if (input.syncConflict) return { state: "COMPLETED", applied: 0, conflicts: 1, notFound: 0, ignored: 0 };
      await outbox.setMetadata({ entityType: type, entityId: "singleton", revision: cloud.revision + 1, updatedAt: "2026-08-24T10:01:00.000Z" });
      await outbox.remove(mutationId);
      return { state: "COMPLETED", applied: 1, conflicts: 0, notFound: 0, ignored: 0 };
    },
  };
  return { outbox, dependencies, historicalIds, setScope: (value) => { currentScope = value; } };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ProtectedPreferenceConflictRebaseError && error.code === code);
}

test("refuse un domaine hors whitelist, un scope non USER et l absence de conflit", async () => {
  const value = await fixture();
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("flight", value.dependencies), "DOMAIN_NOT_ALLOWED");
  value.setScope("GUEST");
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), "USER_REQUIRED");
  const empty = await fixture({ historicalCount: 0 });
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", empty.dependencies), "NO_CONFIRMED_CONFLICT");
});

test("refuse USER switch, lecture Cloud impossible, ligne absente et tombstone", async () => {
  for (const [input, code] of [
    [{ switchDuringRead: true }, "USER_SWITCH"],
    [{ readError: true }, "CLOUD_READ_FAILED"],
    [{ cloud: null }, "CLOUD_ROW_NOT_FOUND"],
    [{ cloud: { revision: 1, updatedAt: "2026-08-24T09:00:00.000Z", deletedAt: "2026-08-24T09:30:00.000Z" } }, "CLOUD_TOMBSTONE"],
  ]) {
    const value = await fixture(input);
    await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), code);
    assert.deepEqual((await value.outbox.list()).map(({ mutationId }) => mutationId), value.historicalIds);
  }
});

test("refuse un payload local invalide sans toucher aux historiques", async () => {
  const value = await fixture({ invalidPayload: true });
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), "INVALID_LOCAL_PAYLOAD");
  assert.deepEqual((await value.outbox.list()).map(({ mutationId }) => mutationId), value.historicalIds);
});

test("refuse une mutation non tentée pour ne jamais la coalescer en place", async () => {
  const value = await fixture({ historicalCount: 1 });
  await value.outbox.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), "UNATTEMPTED_MUTATION_PRESENT");
  assert.equal((await value.outbox.list()).length, 2);
});

test("deux weather historiques produisent une mutation neuve rebasée puis un cleanup après APPLIED", async () => {
  const value = await fixture();
  let synchronizedMutation = null;
  const originalSync = value.dependencies.syncMutationById;
  value.dependencies.syncMutationById = async (mutationId) => {
    synchronizedMutation = (await value.outbox.list()).find((mutation) => mutation.mutationId === mutationId);
    return originalSync(mutationId);
  };
  const result = await resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies);
  assert.equal(synchronizedMutation.baseRevision, 1);
  assert.equal(synchronizedMutation.attempts, 0);
  assert.equal(value.historicalIds.includes(synchronizedMutation.mutationId), false);
  assert.deepEqual(result.removedHistoricalMutationIds, value.historicalIds);
  assert.deepEqual(await value.outbox.list(), []);
  assert.equal((await value.outbox.getMetadata("weather-preferences", "singleton")).revision, 2);
});

test("ALREADY_APPLIED agrégé nettoie aussi et aviation est whitelisté", async () => {
  const value = await fixture({ type: "aviation-preferences", historicalCount: 1 });
  const result = await resolveProtectedPreferenceConflictLocalWins("aviation-preferences", value.dependencies);
  assert.equal(result.finalRevision, 2);
  assert.deepEqual(await value.outbox.list(), []);
});

test("CONFLICT ou erreur conserve tous les historiques et la nouvelle mutation", async () => {
  for (const input of [{ syncConflict: true }, { syncError: true }]) {
    const value = await fixture(input);
    await assert.rejects(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies));
    const remaining = await value.outbox.list();
    assert.equal(remaining.length, 3);
    for (const id of value.historicalIds) assert.ok(remaining.some(({ mutationId }) => mutationId === id));
    assert.ok(remaining.some((mutation) => !value.historicalIds.includes(mutation.mutationId) && mutation.baseRevision === 1));
  }
});

test("un crash entre succès et cleanup ne retire aucune mutation historique", async () => {
  const value = await fixture();
  value.dependencies.outbox = new Proxy(value.outbox, { get(target, property) {
    if (property === "removeMany") return async () => { throw new Error("crash cleanup"); };
    const member = target[property];
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await assert.rejects(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), /crash cleanup/);
  const remaining = await value.outbox.list();
  assert.deepEqual(remaining.map(({ mutationId }) => mutationId), value.historicalIds);
  assert.equal((await value.outbox.getMetadata("weather-preferences", "singleton")).revision, 2);
});
