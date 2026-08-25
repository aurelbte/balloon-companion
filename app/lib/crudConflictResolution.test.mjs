import assert from "node:assert/strict";
import test from "node:test";
import { CrudConflictResolutionError, resolveCrudConflictLocalWins, resolveCrudConflictServerWins } from "./crudConflictResolution.ts";
import { MemoryCloudSyncIssueRepository } from "./cloudSyncService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture(options = {}) {
  let id = 0, currentScope = options.scope ?? scope, onlineUser = Object.hasOwn(options, "onlineUser") ? options.onlineUser : scope.slice(5);
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => `m-${++id}`, now: () => `2026-08-25T10:00:0${id}.000Z` } });
  const issues = new MemoryCloudSyncIssueRepository();
  const historical = await outbox.enqueue({ entityType: options.entityType ?? "favorite-launch-site", entityId: "entity-1", operation: options.operation ?? "UPSERT", baseRevision: 2 });
  if (options.attempted !== false) { await outbox.markAttempt(historical.mutationId); await outbox.updateMutation(historical.mutationId, { lastErrorCode: "CONFLICT" }); }
  if (options.issue !== false) await issues.save({ kind: "CONFLICT", entityType: historical.entityType, entityId: historical.entityId, mutation: historical, serverRevision: 3, serverUpdatedAt: "2026-08-25T09:00:00.000Z", serverDeletedAt: null, recordedAt: "2026-08-25T09:01:00.000Z" });
  const cloud = options.cloud ?? { revision: 3, updatedAt: "2026-08-25T09:00:00.000Z", deletedAt: null, value: { name: "Cloud" } };
  let appliedCloud = 0, syncSnapshot = [], enqueueCountAtApply = -1;
  const dependencies = {
    outbox, issues, getScope: () => currentScope, getOnlineUserId: async () => onlineUser,
    readCloud: async () => { if (options.readError) throw new Error("read"); if (options.switchOnRead) currentScope = "USER:other"; return cloud; },
    applyCloudLocally: async () => { enqueueCountAtApply = (await outbox.list()).length; if (options.applyFails) return false; appliedCloud += 1; return true; },
    buildPayload: async () => options.invalidPayload ? null : ({ serverEntityType: "favorite_launch_site", serverEntityId: "entity-1", payload: { name: "Local" } }),
    syncMutationById: async (mutationId) => {
      syncSnapshot = await outbox.list();
      if (options.secondConflict) return { state: "COMPLETED", applied: 0, conflicts: 1, notFound: 0, ignored: 0 };
      await outbox.setMetadata({ entityType: historical.entityType, entityId: historical.entityId, revision: cloud.revision + 1, updatedAt: "2026-08-25T10:10:00.000Z" });
      await outbox.remove(mutationId);
      return { state: "COMPLETED", applied: 1, conflicts: 0, notFound: 0, ignored: 0 };
    },
  };
  return { outbox, issues, historical, dependencies, cloud, get appliedCloud() { return appliedCloud; }, get syncSnapshot() { return syncSnapshot; }, get enqueueCountAtApply() { return enqueueCountAtApply; }, setScope: (value) => { currentScope = value; }, setOnlineUser: (value) => { onlineUser = value; } };
}

async function rejectsCode(promise, code) { await assert.rejects(promise, (error) => error instanceof CrudConflictResolutionError && error.code === code); }

test("LOCAL WINS crée une mutation neuve rebasée et nettoie seulement après succès", async () => {
  const ctx = await fixture();
  const result = await resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", ctx.dependencies);
  assert.notEqual(result.newMutationId, ctx.historical.mutationId);
  assert.equal(ctx.syncSnapshot.length, 2);
  assert.deepEqual(ctx.syncSnapshot.find(({ mutationId }) => mutationId === ctx.historical.mutationId), { ...ctx.historical, attempts: 1, lastErrorCode: "CONFLICT" });
  assert.equal(ctx.syncSnapshot.find(({ mutationId }) => mutationId === result.newMutationId).baseRevision, 3);
  assert.equal((await ctx.outbox.list()).length, 0);
  assert.equal((await ctx.issues.list()).length, 0);
  assert.equal((await ctx.outbox.getMetadata("favorite-launch-site", "entity-1")).revision, 4);
});

test("LOCAL WINS conserve historique et nouvelle mutation lors d'un second conflit", async () => {
  const ctx = await fixture({ secondConflict: true });
  await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", ctx.dependencies), "REBASED_SYNC_FAILED");
  assert.equal((await ctx.outbox.list()).length, 2);
  assert.equal((await ctx.issues.list()).length, 1);
});

test("SERVER WINS applique silencieusement Cloud, sidecar et cleanup, tombstone inclus", async () => {
  const ctx = await fixture({ cloud: { revision: 4, updatedAt: "2026-08-25T11:00:00.000Z", deletedAt: "2026-08-25T10:59:00.000Z", value: null } });
  const result = await resolveCrudConflictServerWins("favorite-launch-site", "entity-1", ctx.dependencies);
  assert.equal(result.deleted, true); assert.equal(ctx.appliedCloud, 1); assert.equal(ctx.enqueueCountAtApply, 1);
  assert.equal((await ctx.outbox.list()).length, 0); assert.equal((await ctx.issues.list()).length, 0);
  assert.equal((await ctx.outbox.getMetadata("favorite-launch-site", "entity-1")).deletedAt, "2026-08-25T10:59:00.000Z");
});

test("SERVER WINS ne nettoie rien si l'application locale durable échoue", async () => {
  const ctx = await fixture({ applyFails: true });
  await rejectsCode(resolveCrudConflictServerWins("favorite-launch-site", "entity-1", ctx.dependencies), "LOCAL_APPLY_FAILED");
  assert.equal((await ctx.outbox.list()).length, 1); assert.equal((await ctx.issues.list()).length, 1);
});

test("sécurité: whitelist, session, USER switch, lecture, payload, conflit disparu", async () => {
  const normal = await fixture(); await rejectsCode(resolveCrudConflictLocalWins("unit-preferences", "entity-1", normal.dependencies), "DOMAIN_NOT_ALLOWED");
  const guest = await fixture({ scope: "GUEST" }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", guest.dependencies), "USER_REQUIRED");
  const offline = await fixture({ onlineUser: null }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", offline.dependencies), "OFFLINE_OR_SESSION_INVALID");
  const switched = await fixture({ switchOnRead: true }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", switched.dependencies), "USER_SWITCH");
  const read = await fixture({ readError: true }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", read.dependencies), "CLOUD_READ_FAILED");
  const payload = await fixture({ invalidPayload: true }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", payload.dependencies), "INVALID_LOCAL_PAYLOAD");
  const resolved = await fixture({ issue: false }); await rejectsCode(resolveCrudConflictLocalWins("favorite-launch-site", "entity-1", resolved.dependencies), "CONFLICT_NOT_FOUND");
});
