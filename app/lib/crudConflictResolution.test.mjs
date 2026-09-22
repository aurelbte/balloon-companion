import assert from "node:assert/strict";
import test from "node:test";
import { abandonOrphanedFlightMutations, abandonOrphanedLogbookEntryMutations, aggregateCrudConflicts, classifyBlockedFlightMutation, classifyBlockedLogbookEntryMutation, CrudConflictResolutionError, reconcileBlockedFlightMutation, recoverHistoricalOrphanedFlightDiagnostics, resolveCrudConflictLocalWins, resolveCrudConflictServerWins } from "./crudConflictResolution.ts";
import { MemoryCloudSyncIssueRepository } from "./cloudSyncService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture(options = {}) {
  let id = 0, currentScope = options.scope ?? scope, onlineUser = Object.hasOwn(options, "onlineUser") ? options.onlineUser : scope.slice(5);
  const entityId = options.entityId ?? "entity-1";
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => `m-${++id}`, now: () => `2026-08-25T10:00:0${id}.000Z` } });
  const issues = new MemoryCloudSyncIssueRepository();
  const historical = await outbox.enqueue({ entityType: options.entityType ?? "favorite-launch-site", entityId, operation: options.operation ?? "UPSERT", baseRevision: 2 });
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

test("pilot-qualifications CONFLICT sans diagnostic reste visible et résolvable explicitement", async () => {
  const ctx = await fixture({ entityType: "pilot-qualifications", entityId: "singleton", issue: false });
  const [visible] = aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list());
  assert.equal(visible.entityType, "pilot-qualifications");
  assert.equal(visible.entityId, "singleton");
  assert.equal(visible.kind, "CONFLICT");
  assert.equal((await ctx.outbox.list()).length, 1);

  await resolveCrudConflictLocalWins("pilot-qualifications", "singleton", ctx.dependencies);
  assert.equal((await ctx.outbox.list()).length, 0);
  assert.equal((await ctx.issues.list()).length, 0);
});

test("diagnostic et mutation pilot-qualifications sont dédupliqués", async () => {
  const ctx = await fixture({ entityType: "pilot-qualifications", entityId: "singleton" });
  const visible = aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list());
  assert.equal(visible.length, 1);
  assert.equal(visible[0].serverRevision, 3);
  assert.equal(visible[0].integrity, "MATCHED");
});

test("agrège exactement les quatre sources bloquantes C1, y compris hors ancienne whitelist", () => {
  const mutation = (entityType, entityId, lastErrorCode, mutationId) => ({ mutationId, entityType, entityId, operation: "UPSERT", baseRevision: 2, createdAt: "2026-09-20T08:00:00.000Z", attempts: 1, lastErrorCode });
  const revision = mutation("pilot-profile", "singleton", "CONFLICT", "m-revision");
  const duplicate = mutation("balloon", "balloon-1", "DUPLICATE_REGISTRATION", "m-duplicate");
  const diagnosticMutation = mutation("weather-preferences", "singleton", undefined, "m-diagnostic");
  const diagnostics = [
    { kind: "CONFLICT", entityType: "weather-preferences", entityId: "singleton", mutation: diagnosticMutation, serverRevision: 3, serverUpdatedAt: "2026-09-20T08:01:00.000Z", serverDeletedAt: null, recordedAt: "2026-09-20T08:02:00.000Z" },
    { kind: "BUSINESS_CONFLICT", businessCode: "DUPLICATE_REGISTRATION", entityType: "balloon", entityId: "balloon-2", mutation: mutation("balloon", "balloon-2", undefined, "m-business"), serverRevision: null, serverUpdatedAt: null, serverDeletedAt: null, recordedAt: "2026-09-20T08:03:00.000Z" },
  ];
  const visible = aggregateCrudConflicts(diagnostics, [revision, duplicate]);
  assert.equal(visible.length, 4);
  assert.equal(visible.find(value => value.mutationId === "m-revision").integrity, "MUTATION_WITHOUT_DIAGNOSTIC");
  assert.equal(visible.find(value => value.mutationId === "m-revision").resolution, "NONE");
  assert.equal(visible.find(value => value.mutationId === "m-duplicate").businessCode, "DUPLICATE_REGISTRATION");
  assert.equal(visible.find(value => value.mutationId === "m-duplicate").resolution, "NONE");
  assert.equal(visible.find(value => value.entityType === "weather-preferences").integrity, "DIAGNOSTIC_WITHOUT_MUTATION");
  assert.equal(visible.find(value => value.entityId === "balloon-2").integrity, "DIAGNOSTIC_WITHOUT_MUTATION");
});

test("diagnostic et mutation correspondants donnent un conflit MATCHED unique et résolvable seulement si sûr", () => {
  const mutation = { mutationId: "m", entityType: "favorite-launch-site", entityId: "site", operation: "DELETE", baseRevision: 4, createdAt: "2026-09-20T08:00:00.000Z", attempts: 1, lastErrorCode: "CONFLICT" };
  const issue = { kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: 5, serverUpdatedAt: "2026-09-20T08:01:00.000Z", serverDeletedAt: null, recordedAt: "2026-09-20T08:02:00.000Z" };
  const [visible] = aggregateCrudConflicts([issue], [mutation]);
  assert.equal(visible.integrity, "MATCHED");
  assert.equal(visible.resolution, "REVISION");
  assert.equal(visible.operation, "DELETE");
  assert.equal(visible.mutationId, "m");
});

test("échec concurrent sans diagnostic conserve la mutation pilot-qualifications CONFLICT", async () => {
  const ctx = await fixture({ entityType: "pilot-qualifications", entityId: "singleton", issue: false, secondConflict: true });
  await rejectsCode(resolveCrudConflictLocalWins("pilot-qualifications", "singleton", ctx.dependencies), "REBASED_SYNC_FAILED");
  const mutations = await ctx.outbox.list();
  assert.equal(mutations.some(mutation => mutation.mutationId === ctx.historical.mutationId && mutation.lastErrorCode === "CONFLICT"), true);
  assert.equal(aggregateCrudConflicts(await ctx.issues.list(), mutations).length, 1);
});

async function blockedFlightFixture(options = {}) {
  let id = 0;
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => `flight-m-${++id}`, now: () => "2026-09-20T12:00:00.000Z" } });
  const issues = new MemoryCloudSyncIssueRepository();
  const historical = await outbox.enqueue({ entityType: "flight", entityId: "flight-1", operation: "UPSERT", baseRevision: 0, mutationId: "flight-intent" });
  await outbox.markAttempt(historical.mutationId);
  await outbox.freezePayload(historical.mutationId, { serverEntityType: "flight", serverEntityId: "flight-1", payload: {} });
  const blocked = await outbox.updateMutation(historical.mutationId, { lastErrorCode: "RPC_DETERMINISTIC:23502" });
  await issues.save({ kind: "BLOCKED_ERROR", errorCode: "RPC_DETERMINISTIC:23502", entityType: "flight", entityId: "flight-1", mutation: blocked, serverRevision: null, serverUpdatedAt: null, serverDeletedAt: null, recordedAt: "2026-09-20T12:01:00.000Z" });
  let syncSnapshot = [], authCalls = 0, forwardedAuthorization = null;
  const payload = { serverEntityType: "flight", serverEntityId: "flight-1", payload: { status: "COMPLETED", started_at: "2026-09-20T10:00:00.000Z", summary: { durationSeconds: 3600 } } };
  const dependencies = {
    outbox, issues, getScope: () => scope, getOnlineUserId: async () => { authCalls += 1; return scope.slice(5); },
    readCloud: async () => options.cloudMissing ? null : { revision: 7, updatedAt: "2026-09-20T11:00:00.000Z", deletedAt: null, value: {} },
    applyCloudLocally: async () => false,
    buildPayload: async () => options.localMissing ? null : payload,
    syncMutationById: async (mutationId, authorization) => {
      forwardedAuthorization = authorization;
      syncSnapshot = structuredClone(await outbox.list());
      if (options.syncFails) return { state: "STOPPED_ERROR", applied: 0, conflicts: 0, notFound: 0, ignored: 0 };
      const fresh = syncSnapshot.find(mutation => mutation.mutationId === mutationId);
      await outbox.setMetadata({ entityType: "flight", entityId: "flight-1", revision: fresh.baseRevision + 1, updatedAt: "2026-09-20T12:02:00.000Z" });
      await outbox.remove(mutationId);
      return { state: options.successState ?? "PENDING", applied: 1, conflicts: 0, notFound: 0, ignored: 0 };
    },
  };
  return { outbox, issues, historical, payload, dependencies, get syncSnapshot() { return syncSnapshot; }, get authCalls() { return authCalls; }, get forwardedAuthorization() { return forwardedAuthorization; } };
}

test("flight bloqué reconstruit un snapshot actuel sur la vraie révision et conserve l'ancien jusqu'au succès", async () => {
  const ctx = await blockedFlightFixture();
  const [visible] = aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list());
  assert.equal(visible.resolution, "FLIGHT_PAYLOAD");
  const result = await reconcileBlockedFlightMutation("flight-1", ctx.dependencies);
  assert.equal(ctx.syncSnapshot.length, 2);
  assert.ok(ctx.syncSnapshot.some(mutation => mutation.mutationId === ctx.historical.mutationId && mutation.payloadSnapshot?.payload.status === undefined));
  const fresh = ctx.syncSnapshot.find(mutation => mutation.mutationId === result.newMutationId);
  assert.equal(fresh.baseRevision, 7);
  assert.deepEqual(fresh.payloadSnapshot, ctx.payload);
  assert.equal(ctx.authCalls, 1);
  assert.deepEqual(ctx.forwardedAuthorization, { scope, userId: scope.slice(5) });
  assert.equal((await ctx.outbox.list()).length, 0);
  assert.equal((await ctx.issues.list()).length, 0);
  assert.deepEqual((await ctx.outbox.getMetadata("flight", "flight-1")).acknowledgedLocalIntentIds, ["flight-intent"]);
});

test("flight absent ou en échec conserve mutation, snapshot et diagnostic sans tentative automatique", async () => {
  for (const options of [{ localMissing: true }, { syncFails: true }]) {
    const ctx = await blockedFlightFixture(options);
    await assert.rejects(reconcileBlockedFlightMutation("flight-1", ctx.dependencies), error => error instanceof CrudConflictResolutionError && ["INVALID_LOCAL_PAYLOAD", "RECONCILIATION_FAILED"].includes(error.code));
    const remaining = await ctx.outbox.list();
    assert.ok(remaining.some(mutation => mutation.mutationId === ctx.historical.mutationId && mutation.lastErrorCode === "RPC_DETERMINISTIC:23502"));
    assert.deepEqual(remaining.find(mutation => mutation.mutationId === ctx.historical.mutationId).payloadSnapshot.payload, {});
    assert.equal((await ctx.issues.list()).length, 1);
  }
});

test("flight absent du Cloud utilise la révision de création zéro sans deviner le contenu local", async () => {
  const ctx = await blockedFlightFixture({ cloudMissing: true });
  const result = await reconcileBlockedFlightMutation("flight-1", ctx.dependencies);
  assert.equal(ctx.syncSnapshot.find(mutation => mutation.mutationId === result.newMutationId).baseRevision, 0);
});

async function orphanedFlightFixture() {
  let id = 0, currentScope = scope, generation = 4;
  let local = { reconstructible: false, rawRecordPresent: false, activeFlightWithSameId: false, matchingIntentIds: [] };
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => `orphan-${++id}`, now: () => `2026-09-21T10:00:0${id}.000Z` } });
  const issues = new MemoryCloudSyncIssueRepository();
  const block = async (entityId, operation = "UPSERT") => {
    const mutation = await outbox.enqueueFresh({ entityType: "flight", entityId, operation, baseRevision: 0 });
    await outbox.markAttempt(mutation.mutationId);
    await outbox.freezePayload(mutation.mutationId, { serverEntityType: "flight", serverEntityId: entityId, payload: {} });
    return outbox.updateMutation(mutation.mutationId, { lastErrorCode: "RPC_DETERMINISTIC:23502" });
  };
  const first = await block("flight-orphan"), second = await block("flight-orphan");
  await issues.save({ kind: "BLOCKED_ERROR", errorCode: "RPC_DETERMINISTIC:23502", entityType: "flight", entityId: "flight-orphan", mutation: first, serverRevision: null, serverUpdatedAt: null, serverDeletedAt: null, recordedAt: "2026-09-21T10:01:00.000Z" });
  const dependencies = {
    outbox, issues, getScope: () => currentScope, getOnlineUserId: async () => scope.slice(5),
    readCloud: async () => null, applyCloudLocally: async () => false, buildPayload: async () => null,
    syncMutationById: async () => ({ state: "STOPPED_ERROR", applied: 0, conflicts: 0, notFound: 0, ignored: 0 }),
    getScopeGeneration: () => generation, inspectFlightLocalState: async () => structuredClone(local),
  };
  return { outbox, issues, dependencies, ids: [first.mutationId, second.mutationId], block,
    setLocal: value => { local = { ...local, ...value }; }, switchScope: () => { currentScope = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; generation += 1; }, bumpGeneration: () => { generation += 1; } };
}

test("flight orphelin exige confirmation puis retire seulement ses UPSERT bloqués et leurs snapshots", async () => {
  const ctx = await orphanedFlightFixture();
  assert.deepEqual(await classifyBlockedFlightMutation("flight-orphan", ctx.dependencies), { state: "ORPHANED", mutationCount: 2 });
  assert.equal((await ctx.outbox.list()).length, 2, "inspection sans confirmation non mutante");
  await ctx.block("other-flight");
  await ctx.block("flight-orphan", "DELETE");
  const otherDomain = await ctx.outbox.enqueueFresh({ entityType: "balloon", entityId: "flight-orphan", operation: "UPSERT", baseRevision: 0 });
  const removeIssue = ctx.issues.remove.bind(ctx.issues);
  let targetMutationsWhenDiagnosticRemoved = -1;
  ctx.issues.remove = async (...args) => {
    targetMutationsWhenDiagnosticRemoved = (await ctx.outbox.list()).filter(mutation => ctx.ids.includes(mutation.mutationId)).length;
    return removeIssue(...args);
  };
  const result = await abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies);
  assert.deepEqual(result.removedMutationIds, [...ctx.ids].sort());
  assert.equal(targetMutationsWhenDiagnosticRemoved, 0, "le diagnostic est retiré seulement après le commit outbox");
  const remaining = await ctx.outbox.list();
  assert.equal(remaining.length, 3);
  assert.ok(remaining.some(mutation => mutation.entityId === "other-flight"));
  assert.ok(remaining.some(mutation => mutation.entityId === "flight-orphan" && mutation.operation === "DELETE"));
  assert.ok(remaining.some(mutation => mutation.mutationId === otherDomain.mutationId));
  assert.equal((await ctx.issues.list()).length, 0);
  assert.equal(aggregateCrudConflicts(await ctx.issues.list(), remaining).some(issue => issue.entityId === "flight-orphan" && issue.operation === "UPSERT"), false);
});

test("cleanup post-abandon: aucun diagnostic flight orphelin ne subsiste dans la source C1", async () => {
  const ctx = await orphanedFlightFixture();
  await abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies);
  assert.equal((await ctx.outbox.list()).some(mutation => mutation.entityId === "flight-orphan"), false);
  assert.equal((await ctx.issues.list()).some(issue => issue.entityId === "flight-orphan"), false);
  assert.deepEqual(aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list()), []);
});

test("récupération historique: diagnostic flight sans mutation ni donnée locale est nettoyé pour C1", async () => {
  const ctx = await orphanedFlightFixture();
  await ctx.outbox.removeManyIfUnchanged(await ctx.outbox.list());
  assert.equal((await ctx.issues.list()).length, 1);
  const result = await recoverHistoricalOrphanedFlightDiagnostics(ctx.dependencies);
  assert.deepEqual(result.removedEntityIds, ["flight-orphan"]);
  assert.equal((await ctx.issues.list()).length, 0);
  assert.deepEqual(aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list()), []);
});

test("récupération historique conserve tout diagnostic ambigu ou encore associé", async () => {
  for (const protect of ["MUTATION", "FLIGHT", "RAW", "ACTIVE", "INTENT", "SNAPSHOT"]) {
    const ctx = await orphanedFlightFixture();
    if (protect !== "MUTATION") await ctx.outbox.removeManyIfUnchanged(await ctx.outbox.list());
    if (protect === "FLIGHT") ctx.setLocal({ reconstructible: true });
    if (protect === "RAW") ctx.setLocal({ rawRecordPresent: true });
    if (protect === "ACTIVE") ctx.setLocal({ activeFlightWithSameId: true });
    if (protect === "INTENT") ctx.setLocal({ matchingIntentIds: ["intent"] });
    if (protect === "SNAPSHOT") {
      const [issue] = await ctx.issues.list();
      await ctx.issues.save({ ...issue, mutation: { ...issue.mutation, payloadSnapshot: { serverEntityType: "flight", serverEntityId: "flight-orphan", payload: { status: "COMPLETED", started_at: "2026-09-21T08:00:00.000Z", summary: {} } } } });
    }
    assert.deepEqual((await recoverHistoricalOrphanedFlightDiagnostics(ctx.dependencies)).removedEntityIds, []);
    assert.equal((await ctx.issues.list()).length, 1);
  }
  const switched = await orphanedFlightFixture();
  await switched.outbox.removeManyIfUnchanged(await switched.outbox.list());
  const inspect = switched.dependencies.inspectFlightLocalState;
  switched.dependencies.inspectFlightLocalState = async id => { const local = await inspect(id); switched.switchScope(); return local; };
  await rejectsCode(recoverHistoricalOrphanedFlightDiagnostics(switched.dependencies), "USER_SWITCH");
  assert.equal((await switched.issues.list()).length, 1);
});

test("un diagnostic remplacé pour une autre mutation n'est jamais supprimé par l'abandon", async () => {
  const ctx = await orphanedFlightFixture();
  const remove = ctx.outbox.removeManyIfUnchanged.bind(ctx.outbox);
  ctx.outbox.removeManyIfUnchanged = async mutations => {
    const removed = await remove(mutations);
    await ctx.issues.save({ kind: "BLOCKED_ERROR", errorCode: "OTHER", entityType: "flight", entityId: "flight-orphan",
      mutation: { mutationId: "newer", entityType: "flight", entityId: "flight-orphan", operation: "UPSERT", baseRevision: 0, createdAt: "2026-09-21T11:00:00.000Z", attempts: 1, lastErrorCode: "OTHER" },
      serverRevision: null, serverUpdatedAt: null, serverDeletedAt: null, recordedAt: "2026-09-21T11:01:00.000Z" });
    return removed;
  };
  await rejectsCode(abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies), "DIAGNOSTIC_CHANGED");
  assert.equal((await ctx.issues.list())[0].mutation.mutationId, "newer");
});

test("flight réapparu, actif ou porteur d'une intention C2 ne peut jamais être abandonné", async () => {
  for (const protectedState of [
    { reconstructible: true }, { rawRecordPresent: true }, { activeFlightWithSameId: true }, { matchingIntentIds: ["intent-new"] },
  ]) {
    const ctx = await orphanedFlightFixture(); ctx.setLocal(protectedState);
    await rejectsCode(abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies), "LOCAL_FLIGHT_RECOVERABLE");
    assert.equal((await ctx.outbox.list()).length, 2);
    assert.equal((await ctx.issues.list()).length, 1);
  }
});

test("un snapshot flight complet reste protégé même si le RecordedFlight local est absent", async () => {
  const ctx = await orphanedFlightFixture();
  const [first] = await ctx.outbox.list();
  await ctx.outbox.updateMutation(first.mutationId, {});
  const stored = ctx.outbox.mutations?.get?.(first.mutationId);
  if (stored) ctx.outbox.mutations.set(first.mutationId, { ...stored, payloadSnapshot: { serverEntityType: "flight", serverEntityId: "flight-orphan", payload: { status: "COMPLETED", started_at: "2026-09-21T08:00:00.000Z", summary: {} } } });
  assert.equal((await classifyBlockedFlightMutation("flight-orphan", ctx.dependencies)).state, "PROTECTED");
  await rejectsCode(abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies), "RECOVERABLE_SNAPSHOT");
  assert.equal((await ctx.outbox.list()).length, 2);
});

test("confirmation périmée, changement de scope ou génération conserve toutes les mutations", async () => {
  const changed = await orphanedFlightFixture(); await changed.block("flight-orphan");
  await rejectsCode(abandonOrphanedFlightMutations("flight-orphan", changed.ids, changed.dependencies), "CONFIRMATION_STALE");
  assert.equal((await changed.outbox.list()).length, 3);
  for (const mutateIdentity of [ctx => ctx.switchScope(), ctx => ctx.bumpGeneration()]) {
    const ctx = await orphanedFlightFixture(); let reads = 0;
    const inspect = ctx.dependencies.inspectFlightLocalState;
    ctx.dependencies.inspectFlightLocalState = async id => { const result = await inspect(id); if (++reads === 1) mutateIdentity(ctx); return result; };
    await rejectsCode(abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies), "USER_SWITCH");
    assert.equal((await ctx.outbox.list()).length, 2);
  }
});

test("panne partielle n'annonce aucun succès et laisse le conflit durable récupérable", async () => {
  const ctx = await orphanedFlightFixture();
  const original = ctx.outbox.removeManyIfUnchanged.bind(ctx.outbox);
  ctx.outbox.removeManyIfUnchanged = async () => { throw new Error("IDB_ABORT"); };
  await assert.rejects(abandonOrphanedFlightMutations("flight-orphan", ctx.ids, ctx.dependencies), /IDB_ABORT/);
  assert.equal((await ctx.outbox.list()).length, 2);
  assert.equal(aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list()).filter(issue => issue.entityId === "flight-orphan").length, 2);
  ctx.outbox.removeManyIfUnchanged = original;
});

async function orphanedLogbookFixture() {
  let id = 0, currentScope = scope, generation = 9;
  let local = { ascensionPresent: false, rawStateReadable: true, matchingIntentIds: [] };
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => `logbook-${++id}`, now: () => `2026-09-22T10:00:0${id}.000Z` } });
  const issues = new MemoryCloudSyncIssueRepository();
  const block = async (entityId, operation = "UPSERT") => {
    const mutation = await outbox.enqueueFresh({ entityType: "logbook-entry", entityId, operation, baseRevision: 0 });
    await outbox.markAttempt(mutation.mutationId);
    const blocked = await outbox.updateMutation(mutation.mutationId, { lastErrorCode: "LOCAL_PAYLOAD_NOT_FOUND" });
    return blocked;
  };
  const mutation = await block("ascension-orphan");
  await issues.save({ kind: "BLOCKED_ERROR", errorCode: "LOCAL_PAYLOAD_NOT_FOUND", entityType: "logbook-entry", entityId: "ascension-orphan", mutation,
    serverRevision: null, serverUpdatedAt: null, serverDeletedAt: null, recordedAt: "2026-09-22T10:01:00.000Z" });
  const dependencies = {
    outbox, issues, getScope: () => currentScope, getOnlineUserId: async () => scope.slice(5), readCloud: async () => null,
    applyCloudLocally: async () => false, buildPayload: async () => null,
    syncMutationById: async () => ({ state: "STOPPED_ERROR", applied: 0, conflicts: 0, notFound: 0, ignored: 0 }),
    getScopeGeneration: () => generation, inspectLogbookEntryLocalState: async () => structuredClone(local),
  };
  return { outbox, issues, mutation, dependencies, block, setLocal: value => { local = { ...local, ...value }; },
    switchScope: () => { currentScope = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; generation += 1; } };
}

test("logbook-entry orpheline devient visible puis abandonne uniquement sa mutation confirmée", async () => {
  const ctx = await orphanedLogbookFixture();
  const [visible] = aggregateCrudConflicts(await ctx.issues.list(), await ctx.outbox.list());
  assert.equal(visible.resolution, "LOGBOOK_PAYLOAD");
  assert.deepEqual(await classifyBlockedLogbookEntryMutation("ascension-orphan", ctx.dependencies), { state: "ORPHANED", mutationCount: 1 });
  const other = await ctx.block("ascension-other");
  const result = await abandonOrphanedLogbookEntryMutations("ascension-orphan", [ctx.mutation.mutationId], ctx.dependencies);
  assert.deepEqual(result.removedMutationIds, [ctx.mutation.mutationId]);
  assert.deepEqual((await ctx.outbox.list()).map(({ mutationId }) => mutationId), [other.mutationId]);
  assert.equal((await ctx.issues.list()).length, 0);
});

test("logbook-entry conserve ascension, intention, snapshot, mutation plus récente et changement d'identité", async () => {
  for (const protection of ["ASCENSION", "UNREADABLE", "INTENT", "SNAPSHOT", "NEWER"]) {
    const ctx = await orphanedLogbookFixture();
    if (protection === "ASCENSION") ctx.setLocal({ ascensionPresent: true });
    if (protection === "UNREADABLE") ctx.setLocal({ rawStateReadable: false });
    if (protection === "INTENT") ctx.setLocal({ matchingIntentIds: ["intent"] });
    if (protection === "SNAPSHOT") {
      const stored = ctx.outbox.mutations.get(ctx.mutation.mutationId);
      ctx.outbox.mutations.set(ctx.mutation.mutationId, { ...stored, payloadSnapshot: { serverEntityType: "logbook_entry", serverEntityId: "ascension-orphan", payload: {
        source: "MANUAL", date_iso: "2026-09-22", balloon_model: "M", registration: "F-TEST", departure: "A", arrival: "B", category: "Libre à air chaud", pilot_function: "Pilote", observations: "", night_flight: false, official_duration_minutes: 60,
      } } });
    }
    if (protection === "NEWER") await ctx.block("ascension-orphan", "DELETE");
    assert.equal((await classifyBlockedLogbookEntryMutation("ascension-orphan", ctx.dependencies)).state, "PROTECTED");
    await assert.rejects(abandonOrphanedLogbookEntryMutations("ascension-orphan", [ctx.mutation.mutationId], ctx.dependencies));
    assert.ok((await ctx.outbox.list()).some(({ mutationId }) => mutationId === ctx.mutation.mutationId));
  }
  const switched = await orphanedLogbookFixture();
  const inspect = switched.dependencies.inspectLogbookEntryLocalState;
  switched.dependencies.inspectLogbookEntryLocalState = async id => { const value = await inspect(id); switched.switchScope(); return value; };
  await rejectsCode(abandonOrphanedLogbookEntryMutations("ascension-orphan", [switched.mutation.mutationId], switched.dependencies), "USER_SWITCH");
  assert.equal((await switched.issues.list()).length, 1);
});

test("logbook-entry: échec du commit atomique conserve mutation et diagnostic", async () => {
  const ctx = await orphanedLogbookFixture();
  ctx.outbox.removeManyIfUnchanged = async () => { throw new Error("IDB_ABORT"); };
  await assert.rejects(abandonOrphanedLogbookEntryMutations("ascension-orphan", [ctx.mutation.mutationId], ctx.dependencies), /IDB_ABORT/);
  assert.equal((await ctx.outbox.list()).length, 1);
  assert.equal((await ctx.issues.list()).length, 1);
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
