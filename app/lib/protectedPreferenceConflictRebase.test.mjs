import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ProtectedPreferenceConflictRebaseError,
  resolveProtectedPreferenceConflictCloudWins,
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
    ? { revision: 1, updatedAt: "2026-08-24T09:00:00.000Z", deletedAt: null,
        value: type === "aviation-preferences" ? { airportIcao: "LFQO", favorites: [] } : { test: "cloud" },
        payload: { serverEntityType: type === "aviation-preferences" ? "aviation_preferences" : "user_preferences", serverEntityId: type === "aviation-preferences" ? "aviation" : type === "unit-preferences" ? "units" : "weather", payload: type === "aviation-preferences" ? { airport_icao: "LFQO", favorites: [], schema_version: 1 } : { schema_version: 1, preferences: { test: "cloud" } } } }
    : input.cloud;
  let localValue = { test: true };
  let pendingIntent = Boolean(input.pendingIntent);
  const removedIssues = [];
  const dependencies = {
    outbox,
    getScope: () => currentScope,
    readCloudState: async () => {
      if (input.readError) throw new Error("offline");
      if (input.switchDuringRead) currentScope = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      return cloud;
    },
    hasPendingIntent: () => pendingIntent,
    issues: { list: async () => [], remove: async (entityType, entityId) => { removedIssues.push(`${entityType}:${entityId}`); } },
    buildPayload: async () => input.invalidPayload ? null : ({
      serverEntityType: type === "aviation-preferences" ? "aviation_preferences" : "user_preferences",
      serverEntityId: type === "aviation-preferences" ? "aviation" : type === "unit-preferences" ? "units" : "weather",
      payload: type === "aviation-preferences" ? { airport_icao: localValue.airportIcao ?? null, favorites: localValue.favorites ?? [], schema_version: 1 } : { schema_version: 1, preferences: localValue },
    }),
    applyCloudLocally: async () => { if (input.applyError) return false; localValue = cloud.value; return true; },
    syncMutationById: async (mutationId) => {
      if (input.syncError) throw new Error("network");
      if (input.syncConflict) return { state: "COMPLETED", applied: 0, conflicts: 1, notFound: 0, ignored: 0 };
      await outbox.setMetadata({ entityType: type, entityId: "singleton", revision: cloud.revision + 1, updatedAt: "2026-08-24T10:01:00.000Z" });
      await outbox.remove(mutationId);
      return { state: "COMPLETED", applied: 1, conflicts: 0, notFound: 0, ignored: 0 };
    },
  };
  return { outbox, dependencies, historicalIds, removedIssues, setScope: (value) => { currentScope = value; }, setPendingIntent: value => { pendingIntent = value; }, setLocal: value => { localValue = value; }, setCloudPayload: payload => { cloud.payload = payload; cloud.value = payload.payload.preferences ?? payload.payload; }, getLocal: () => localValue };
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

for (const type of ["weather-preferences", "unit-preferences", "aviation-preferences"]) {
  test(`${type}: cinq conflits sont remplacés seulement après mutation canonique confirmée`, async () => {
    const value = await fixture({ type, historicalCount: 5 });
    const result = await resolveProtectedPreferenceConflictLocalWins(type, value.dependencies);
    assert.equal(result.removedHistoricalMutationIds.length, 5);
    assert.deepEqual(await value.outbox.list(), []);
    assert.deepEqual(value.removedIssues, [`${type}:singleton`]);
  });

  test(`${type}: garder Cloud applique sans enqueue et aligne le sidecar`, async () => {
    const value = await fixture({ type, historicalCount: 5 });
    const beforeNextId = (await value.outbox.list()).length;
    const result = await resolveProtectedPreferenceConflictCloudWins(type, value.dependencies);
    assert.equal(result.finalRevision, 1);
    assert.equal(beforeNextId, 5);
    assert.deepEqual(await value.outbox.list(), []);
    assert.deepEqual(value.getLocal(), type === "aviation-preferences" ? { airportIcao: "LFQO", favorites: [] } : { test: "cloud" });
    assert.equal((await value.outbox.getMetadata(type, "singleton")).revision, 1);
  });
}

test("une intention C2 bloque les deux choix sans nettoyage", async () => {
  for (const resolver of [resolveProtectedPreferenceConflictLocalWins, resolveProtectedPreferenceConflictCloudWins]) {
    const value = await fixture({ pendingIntent: true });
    await rejectsCode(resolver("weather-preferences", value.dependencies), "PENDING_INTENT");
    assert.deepEqual((await value.outbox.list()).map(m => m.mutationId), value.historicalIds);
  }
});

test("échec de persistance Cloud conserve toute la chaîne", async () => {
  const value = await fixture({ applyError: true, historicalCount: 5 });
  await rejectsCode(resolveProtectedPreferenceConflictCloudWins("weather-preferences", value.dependencies), "LOCAL_APPLY_FAILED");
  assert.equal((await value.outbox.list()).length, 5);
});

test("une écriture concurrente pendant l'envoi local n'est ni perdue ni nettoyée", async () => {
  const value = await fixture({ historicalCount: 2 });
  const original = value.dependencies.syncMutationById;
  value.dependencies.syncMutationById = async id => { const result = await original(id); value.setLocal({ test: "newer" }); return result; };
  await rejectsCode(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), "LOCAL_CHANGED");
  assert.deepEqual((await value.outbox.list()).map(m => m.mutationId), value.historicalIds);
});

test("une nouvelle mutation apparue pendant garder Cloud reste intacte et interdit le cleanup", async () => {
  const value = await fixture({ historicalCount: 2 });
  value.dependencies.applyCloudLocally = async (_type, cloud) => {
    value.setLocal(cloud.value);
    await value.outbox.enqueueFresh({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT", baseRevision: 1 });
    return true;
  };
  await rejectsCode(resolveProtectedPreferenceConflictCloudWins("weather-preferences", value.dependencies), "CHAIN_CHANGED");
  assert.equal((await value.outbox.list()).length, 3);
});

test("reprise après succès serveur avant cleanup est idempotente", async () => {
  const value = await fixture({ historicalCount: 2 });
  let calls = 0;
  const original = value.dependencies.syncMutationById;
  value.dependencies.syncMutationById = async id => { calls += 1; const result = await original(id); value.setCloudPayload({ serverEntityType: "user_preferences", serverEntityId: "weather", payload: { schema_version: 1, preferences: { test: true } } }); return result; };
  let crashed = false;
  value.dependencies.outbox = new Proxy(value.outbox, { get(target, property) {
    if (property === "removeMany" && !crashed) return async () => { crashed = true; throw new Error("crash cleanup"); };
    const member = target[property]; return typeof member === "function" ? member.bind(target) : member;
  } });
  await assert.rejects(resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies), /crash cleanup/);
  value.dependencies.outbox = value.outbox;
  await resolveProtectedPreferenceConflictLocalWins("weather-preferences", value.dependencies);
  assert.equal(calls, 1);
  assert.deepEqual(await value.outbox.list(), []);
});

test("le scope qui change pendant la voie Cloud interdit le nettoyage", async () => {
  const value = await fixture();
  value.dependencies.applyCloudLocally = async (_type, cloud) => { value.setLocal(cloud.value); value.setScope("USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); return true; };
  await rejectsCode(resolveProtectedPreferenceConflictCloudWins("weather-preferences", value.dependencies), "USER_SWITCH");
  assert.equal((await value.outbox.list()).length, 2);
});

test("l'UI regroupe la chaîne singleton et exige une confirmation explicite", async () => {
  const source = await readFile(new URL("../more/cloud-sync/page.tsx", import.meta.url), "utf8");
  assert.match(source, /protectedPreferenceChains/);
  assert.match(source, /Garder les préférences de cet appareil/);
  assert.match(source, /Garder les préférences du Cloud/);
  assert.match(source, /Confirmer/);
  assert.match(source, /Résolution en cours/);
});
