import type { LocalDataScope } from "./auth/dataScope.ts";
import { isDurablyBlockedCloudSyncMutation, type CloudSyncIssue, type CloudSyncIssueRepository, type CloudSyncPassResult, type CloudSyncPayload } from "./cloudSyncService.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";
import { isCloudSyncConflictIssue, isCloudSyncConflictMutation } from "./cloudSyncVerdict.ts";

export const CRUD_CONFLICT_ENTITY_TYPES = Object.freeze([
  "favorite-weather-place", "favorite-launch-site", "balloon", "flight", "logbook-entry", "balloon-document", "pilot-qualifications",
] as const);
export type CrudConflictEntityType = typeof CRUD_CONFLICT_ENTITY_TYPES[number];
export type CrudCloudState = Readonly<{ revision: number; updatedAt: string; deletedAt: string | null; value: unknown }>;

export type CrudConflictResolutionDependencies = Readonly<{
  outbox: SyncOutboxStorage;
  issues: CloudSyncIssueRepository;
  getScope(): LocalDataScope | null;
  getOnlineUserId(): Promise<string | null>;
  readCloud(entityType: CrudConflictEntityType, entityId: string): Promise<CrudCloudState | null>;
  applyCloudLocally(entityType: CrudConflictEntityType, entityId: string, cloud: CrudCloudState): Promise<boolean>;
  buildPayload(mutation: SyncMutation): Promise<CloudSyncPayload | null>;
  syncMutationById(mutationId: string, authorization?: Readonly<{ scope: `USER:${string}`; userId: string }>): Promise<CloudSyncPassResult>;
  getScopeGeneration?(): number;
  inspectFlightLocalState?(entityId: string): Promise<Readonly<{
    reconstructible: boolean;
    rawRecordPresent: boolean;
    activeFlightWithSameId: boolean;
    matchingIntentIds: readonly string[];
  }>>;
}>;

export class CrudConflictResolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "CrudConflictResolutionError"; this.code = code; }
}

function allowed(value: string): value is CrudConflictEntityType { return CRUD_CONFLICT_ENTITY_TYPES.includes(value as CrudConflictEntityType); }
function userScope(value: LocalDataScope | null): value is `USER:${string}` { return Boolean(value?.startsWith("USER:") && value.length > 5); }
function assertScope(dependencies: CrudConflictResolutionDependencies, scope: `USER:${string}`): void {
  if (dependencies.getScope() !== scope) throw new CrudConflictResolutionError("USER_SWITCH", "Le compte actif a changé");
}

export type CloudSyncConflictIntegrity = "MATCHED" | "MUTATION_WITHOUT_DIAGNOSTIC" | "DIAGNOSTIC_WITHOUT_MUTATION";
export type CloudSyncConflictResolution = "REVISION" | "DUPLICATE_REGISTRATION" | "FLIGHT_PAYLOAD" | "FLIGHT_ORPHAN" | "NONE";
export type AggregatedCloudSyncConflict = Readonly<{
  kind: "CONFLICT" | "BUSINESS_CONFLICT" | "BLOCKED_ERROR";
  businessCode?: "DUPLICATE_REGISTRATION";
  entityType: string;
  entityId: string;
  mutationId: string | null;
  operation: SyncMutation["operation"] | null;
  createdAt: string | null;
  recordedAt: string | null;
  baseRevision: number | null;
  serverRevision: number | null;
  serverUpdatedAt: string | null;
  serverDeletedAt: string | null;
  attempts: number | null;
  lastErrorCode: string | null;
  diagnosticPresent: boolean;
  mutationPresent: boolean;
  integrity: CloudSyncConflictIntegrity;
  resolution: CloudSyncConflictResolution;
  relatedMutationCount?: number;
}>;

export function aggregateCrudConflicts(issues: readonly CloudSyncIssue[], mutations: readonly SyncMutation[]): readonly AggregatedCloudSyncConflict[] {
  const diagnostics = issues.filter(issue => isCloudSyncConflictIssue(issue) || issue.kind === "BLOCKED_ERROR" && issue.entityType === "flight");
  const conflictMutations = mutations.filter(mutation => isCloudSyncConflictMutation(mutation) || mutation.entityType === "flight" && isDurablyBlockedCloudSyncMutation(mutation));
  const usedMutationIds = new Set<string>();
  const aggregate = (entityType: string, entityId: string, diagnostic: CloudSyncIssue | null, mutation: SyncMutation | null): AggregatedCloudSyncConflict => {
    const businessCode = diagnostic?.businessCode ?? (mutation?.lastErrorCode === "DUPLICATE_REGISTRATION" ? "DUPLICATE_REGISTRATION" : undefined);
    const kind = diagnostic?.kind === "BLOCKED_ERROR" || Boolean(mutation?.entityType === "flight" && isDurablyBlockedCloudSyncMutation(mutation)) ? "BLOCKED_ERROR" : businessCode ? "BUSINESS_CONFLICT" : "CONFLICT";
    const diagnosticPresent = Boolean(diagnostic), mutationPresent = Boolean(mutation);
    const integrity: CloudSyncConflictIntegrity = diagnosticPresent && mutationPresent ? "MATCHED" : mutationPresent ? "MUTATION_WITHOUT_DIAGNOSTIC" : "DIAGNOSTIC_WITHOUT_MUTATION";
    const revisionResolvable = kind === "CONFLICT" && mutationPresent && allowed(entityType)
      && (diagnosticPresent || (entityType === "pilot-qualifications" && entityId === "singleton"));
    const duplicateResolvable = businessCode === "DUPLICATE_REGISTRATION" && diagnosticPresent && mutationPresent && entityType === "balloon";
    const flightPayloadResolvable = kind === "BLOCKED_ERROR" && mutationPresent && entityType === "flight" && mutation?.operation === "UPSERT";
    return {
      kind, ...(businessCode ? { businessCode } : {}), entityType: entityType!, entityId: entityId!,
      mutationId: mutation?.mutationId ?? diagnostic?.mutation?.mutationId ?? null,
      operation: mutation?.operation ?? diagnostic?.mutation?.operation ?? null,
      createdAt: mutation?.createdAt ?? diagnostic?.mutation?.createdAt ?? null,
      recordedAt: diagnostic?.recordedAt ?? null,
      baseRevision: mutation?.baseRevision ?? diagnostic?.mutation?.baseRevision ?? null,
      serverRevision: diagnostic?.serverRevision ?? null,
      serverUpdatedAt: diagnostic?.serverUpdatedAt ?? null,
      serverDeletedAt: diagnostic?.serverDeletedAt ?? null,
      attempts: mutation?.attempts ?? diagnostic?.mutation?.attempts ?? null,
      lastErrorCode: mutation?.lastErrorCode ?? diagnostic?.mutation?.lastErrorCode ?? null,
      diagnosticPresent, mutationPresent, integrity,
      resolution: duplicateResolvable ? "DUPLICATE_REGISTRATION" : revisionResolvable ? "REVISION" : flightPayloadResolvable ? "FLIGHT_PAYLOAD" : "NONE",
    };
  };
  const result = diagnostics.map(diagnostic => {
    const mutation = conflictMutations.find(candidate => candidate.mutationId === diagnostic.mutation?.mutationId) ?? null;
    if (mutation) usedMutationIds.add(mutation.mutationId);
    return aggregate(diagnostic.entityType, diagnostic.entityId, diagnostic, mutation);
  });
  for (const mutation of conflictMutations) {
    if (!usedMutationIds.has(mutation.mutationId)) result.push(aggregate(mutation.entityType, mutation.entityId, null, mutation));
  }
  return result;
}

function blockedFlightMutations(mutations: readonly SyncMutation[], entityId: string): SyncMutation[] {
  return mutations.filter((mutation) => mutation.entityType === "flight" && mutation.entityId === entityId
    && mutation.operation === "UPSERT" && isDurablyBlockedCloudSyncMutation(mutation));
}

export async function classifyBlockedFlightMutation(entityId: string, dependencies: CrudConflictResolutionDependencies) {
  if (!dependencies.inspectFlightLocalState) return { state: "UNREADABLE" as const, mutationCount: 0 };
  const mutations = blockedFlightMutations(await dependencies.outbox.list(), entityId);
  if (!mutations.length) return { state: "MISSING_MUTATION" as const, mutationCount: 0 };
  const local = await dependencies.inspectFlightLocalState(entityId);
  const state = local.reconstructible
    ? "RECONSTRUCTIBLE" as const
    : !local.rawRecordPresent && !local.activeFlightWithSameId && local.matchingIntentIds.length === 0
      && !mutations.some((mutation) => validFlightPayload(mutation.payloadSnapshot ?? null))
      ? "ORPHANED" as const
      : "PROTECTED" as const;
  return { state, mutationCount: mutations.length };
}

export async function abandonOrphanedFlightMutations(
  entityId: string,
  expectedMutationIds: readonly string[],
  dependencies: CrudConflictResolutionDependencies,
) {
  const scope = dependencies.getScope();
  if (!userScope(scope)) throw new CrudConflictResolutionError("USER_REQUIRED", "Utilisateur connecté requis");
  if (!dependencies.inspectFlightLocalState || !dependencies.getScopeGeneration) throw new CrudConflictResolutionError("LOCAL_INSPECTION_UNAVAILABLE", "Inspection locale indisponible");
  const generation = dependencies.getScopeGeneration();
  const assertIdentity = () => {
    assertScope(dependencies, scope);
    if (dependencies.getScopeGeneration!() !== generation) throw new CrudConflictResolutionError("USER_SWITCH", "Le compte actif a changé");
  };
  const expected = [...new Set(expectedMutationIds)].sort();
  if (!expected.length) throw new CrudConflictResolutionError("CONFIRMATION_STALE", "La confirmation n’est plus applicable");
  const inspectAbsent = async () => {
    const local = await dependencies.inspectFlightLocalState!(entityId);
    assertIdentity();
    if (local.reconstructible || local.rawRecordPresent || local.activeFlightWithSameId || local.matchingIntentIds.length) {
      throw new CrudConflictResolutionError("LOCAL_FLIGHT_RECOVERABLE", "Un état local récupérable empêche l’abandon");
    }
  };
  await inspectAbsent();
  const current = blockedFlightMutations(await dependencies.outbox.list(), entityId);
  assertIdentity();
  const currentIds = current.map(({ mutationId }) => mutationId).sort();
  if (currentIds.length !== expected.length || currentIds.some((id, index) => id !== expected[index])) {
    throw new CrudConflictResolutionError("CONFIRMATION_STALE", "Les mutations ont changé depuis la confirmation");
  }
  if (current.some((mutation) => validFlightPayload(mutation.payloadSnapshot ?? null))) {
    throw new CrudConflictResolutionError("RECOVERABLE_SNAPSHOT", "Un snapshot complet empêche l’abandon");
  }
  // Re-read immediately before the first destructive step. A raw record or C2 intent always wins.
  await inspectAbsent();
  if (!await dependencies.outbox.removeManyIfUnchanged(current)) {
    throw new CrudConflictResolutionError("CONFIRMATION_STALE", "Les mutations ont changé pendant la confirmation");
  }
  assertIdentity();
  const remaining = await dependencies.outbox.list();
  assertIdentity();
  if (remaining.some((mutation) => currentIds.includes(mutation.mutationId))) {
    throw new CrudConflictResolutionError("ORPHAN_CLEANUP_INCOMPLETE", "Les mutations abandonnées sont encore présentes");
  }
  const issue = (await dependencies.issues.list()).find((candidate) => candidate.entityType === "flight" && candidate.entityId === entityId);
  assertIdentity();
  if (issue) {
    const diagnosticMutationId = issue.mutation?.mutationId;
    if (!diagnosticMutationId || !currentIds.includes(diagnosticMutationId)) {
      throw new CrudConflictResolutionError("DIAGNOSTIC_CHANGED", "Le diagnostic ne correspond plus aux mutations abandonnées");
    }
    await dependencies.issues.remove("flight", entityId);
  }
  return { entityType: "flight", entityId, removedMutationIds: currentIds } as const;
}

export async function recoverHistoricalOrphanedFlightDiagnostics(dependencies: CrudConflictResolutionDependencies) {
  const scope = dependencies.getScope();
  if (!userScope(scope) || !dependencies.inspectFlightLocalState || !dependencies.getScopeGeneration) return { removedEntityIds: [] as string[] };
  const generation = dependencies.getScopeGeneration();
  const assertIdentity = () => {
    assertScope(dependencies, scope);
    if (dependencies.getScopeGeneration!() !== generation) throw new CrudConflictResolutionError("USER_SWITCH", "Le compte actif a changé");
  };
  const initialMutations = await dependencies.outbox.list();
  assertIdentity();
  const initialIssues = await dependencies.issues.list();
  assertIdentity();
  const removedEntityIds: string[] = [];
  for (const issue of initialIssues) {
    const diagnosticMutation = issue.mutation;
    if (issue.kind !== "BLOCKED_ERROR" || issue.entityType !== "flight" || diagnosticMutation?.operation !== "UPSERT"
      || !isDurablyBlockedCloudSyncMutation(diagnosticMutation) || !diagnosticMutation.mutationId) continue;
    if (initialMutations.some((mutation) => mutation.entityType === "flight" && mutation.entityId === issue.entityId)) continue;
    if (validFlightPayload(diagnosticMutation.payloadSnapshot ?? null)) continue;
    const local = await dependencies.inspectFlightLocalState(issue.entityId);
    assertIdentity();
    if (local.reconstructible || local.rawRecordPresent || local.activeFlightWithSameId || local.matchingIntentIds.length) continue;

    const currentMutations = await dependencies.outbox.list();
    assertIdentity();
    if (currentMutations.some((mutation) => mutation.entityType === "flight" && mutation.entityId === issue.entityId)) continue;
    const currentIssue = (await dependencies.issues.list()).find((candidate) => candidate.entityType === "flight" && candidate.entityId === issue.entityId);
    assertIdentity();
    if (!currentIssue || JSON.stringify(currentIssue) !== JSON.stringify(issue)) continue;
    const finalLocal = await dependencies.inspectFlightLocalState(issue.entityId);
    assertIdentity();
    if (finalLocal.reconstructible || finalLocal.rawRecordPresent || finalLocal.activeFlightWithSameId || finalLocal.matchingIntentIds.length) continue;
    await dependencies.issues.remove("flight", issue.entityId);
    assertIdentity();
    removedEntityIds.push(issue.entityId);
  }
  return { removedEntityIds };
}

function validFlightPayload(payload: CloudSyncPayload | null): payload is CloudSyncPayload {
  if (!payload || payload.serverEntityType !== "flight") return false;
  const value = payload.payload;
  return ["RECORDING", "COMPLETED", "INTERRUPTED"].includes(String(value.status))
    && typeof value.started_at === "string" && Number.isFinite(Date.parse(value.started_at))
    && value.summary !== null && typeof value.summary === "object";
}

export async function reconcileBlockedFlightMutation(entityId: string, dependencies: CrudConflictResolutionDependencies) {
  const scope = dependencies.getScope();
  if (!userScope(scope)) throw new CrudConflictResolutionError("USER_REQUIRED", "Utilisateur connecté requis");
  const userId = await dependencies.getOnlineUserId().catch(() => null);
  if (userId !== scope.slice(5)) throw new CrudConflictResolutionError("OFFLINE_OR_SESSION_INVALID", "Session Cloud indisponible");
  assertScope(dependencies, scope);
  const historical = (await dependencies.outbox.list()).filter(mutation => mutation.entityType === "flight" && mutation.entityId === entityId && mutation.operation === "UPSERT" && isDurablyBlockedCloudSyncMutation(mutation));
  const blocked = historical.at(-1);
  if (!blocked) throw new CrudConflictResolutionError("BLOCKED_MUTATION_NOT_FOUND", "La mutation bloquée n’est plus présente");
  const existingIssue = (await dependencies.issues.list()).find(issue => issue.kind === "BLOCKED_ERROR" && issue.entityType === "flight" && issue.entityId === entityId);
  const payload = await dependencies.buildPayload(blocked);
  if (!validFlightPayload(payload)) throw new CrudConflictResolutionError("INVALID_LOCAL_PAYLOAD", "Le vol local est absent ou invalide. Une intervention est nécessaire.");
  assertScope(dependencies, scope);
  const cloud = await dependencies.readCloud("flight", entityId).catch(() => { throw new CrudConflictResolutionError("CLOUD_READ_FAILED", "Lecture Cloud impossible"); });
  assertScope(dependencies, scope);
  const baseRevision = cloud === null ? 0 : cloud.revision;
  if (!Number.isInteger(baseRevision) || baseRevision < 0 || cloud && !cloud.updatedAt) throw new CrudConflictResolutionError("CLOUD_STATE_INVALID", "État Cloud invalide");
  const fresh = await dependencies.outbox.enqueueFresh({ entityType: "flight", entityId, operation: "UPSERT", baseRevision });
  const reserved = await dependencies.outbox.markAttempt(fresh.mutationId);
  if (!reserved) throw new CrudConflictResolutionError("FRESH_MUTATION_REQUIRED", "La nouvelle tentative n’a pas pu être réservée");
  await dependencies.outbox.freezePayload(fresh.mutationId, payload);
  assertScope(dependencies, scope);
  const result = await dependencies.syncMutationById(fresh.mutationId, { scope, userId });
  assertScope(dependencies, scope);
  if (result.applied !== 1 || result.conflicts !== 0) throw new CrudConflictResolutionError("RECONCILIATION_FAILED", "Le vol reconstruit n’a pas été appliqué");
  const finalMetadata = await dependencies.outbox.getMetadata("flight", entityId);
  if (!finalMetadata || finalMetadata.revision !== baseRevision + 1) throw new CrudConflictResolutionError("FINAL_SIDECAR_INVALID", "Révision locale finale invalide");
  await dependencies.issues.save(existingIssue ?? {
    kind: "BLOCKED_ERROR", errorCode: blocked.lastErrorCode, entityType: "flight", entityId, mutation: blocked,
    serverRevision: cloud?.revision ?? null, serverUpdatedAt: cloud?.updatedAt ?? null, serverDeletedAt: cloud?.deletedAt ?? null,
    recordedAt: new Date().toISOString(),
  });
  for (const mutation of historical) await dependencies.outbox.acknowledge(mutation.mutationId, finalMetadata);
  await dependencies.issues.remove("flight", entityId);
  return { entityType: "flight", entityId, newMutationId: fresh.mutationId, finalRevision: finalMetadata.revision } as const;
}

async function confirmedContext(entityType: string, entityId: string, dependencies: CrudConflictResolutionDependencies) {
  if (!allowed(entityType)) throw new CrudConflictResolutionError("DOMAIN_NOT_ALLOWED", "Domaine CRUD non autorisé");
  const scope = dependencies.getScope();
  if (!userScope(scope)) throw new CrudConflictResolutionError("USER_REQUIRED", "Utilisateur connecté requis");
  if (await dependencies.getOnlineUserId().catch(() => null) !== scope.slice(5)) throw new CrudConflictResolutionError("OFFLINE_OR_SESSION_INVALID", "Session Cloud indisponible");
  assertScope(dependencies, scope);
  const issue = (await dependencies.issues.list()).find((candidate) => candidate.kind === "CONFLICT" && candidate.entityType === entityType && candidate.entityId === entityId);
  const historical = (await dependencies.outbox.list()).filter((mutation) => mutation.entityType === entityType && mutation.entityId === entityId);
  const durableMutationConflict = entityType === "pilot-qualifications" && entityId === "singleton" && historical.some(mutation => mutation.lastErrorCode === "CONFLICT");
  if ((!issue && !durableMutationConflict) || historical.length === 0) throw new CrudConflictResolutionError("CONFLICT_NOT_FOUND", "Ce conflit n’est plus présent");
  const cloud = await dependencies.readCloud(entityType, entityId).catch(() => { throw new CrudConflictResolutionError("CLOUD_READ_FAILED", "Lecture Cloud impossible"); });
  assertScope(dependencies, scope);
  if (!cloud || !Number.isInteger(cloud.revision) || cloud.revision < 0 || !cloud.updatedAt) throw new CrudConflictResolutionError("CLOUD_STATE_INVALID", "État Cloud invalide");
  return { entityType, entityId, scope, cloud, historical } as const;
}

export async function resolveCrudConflictLocalWins(entityType: string, entityId: string, dependencies: CrudConflictResolutionDependencies) {
  const context = await confirmedContext(entityType, entityId, dependencies);
  if (context.cloud.deletedAt) throw new CrudConflictResolutionError("CLOUD_TOMBSTONE", "Une donnée Cloud supprimée ne peut pas être recréée implicitement");
  const latest = context.historical.at(-1)!;
  const payload = latest.operation === "DELETE" ? { serverEntityType: context.entityType, serverEntityId: context.entityId, payload: {} } : await dependencies.buildPayload(latest);
  if (!payload || latest.operation === "UPSERT" && Object.keys(payload.payload).length === 0) throw new CrudConflictResolutionError("INVALID_LOCAL_PAYLOAD", "La version locale n’est plus disponible");
  assertScope(dependencies, context.scope);
  await dependencies.outbox.setMetadata({ entityType: context.entityType, entityId: context.entityId, revision: context.cloud.revision, updatedAt: context.cloud.updatedAt });
  const rebased = await dependencies.outbox.enqueueFresh({ entityType: context.entityType, entityId: context.entityId, operation: latest.operation, baseRevision: context.cloud.revision });
  if (context.historical.some(({ mutationId }) => mutationId === rebased.mutationId)) throw new CrudConflictResolutionError("FRESH_MUTATION_REQUIRED", "Une nouvelle mutation est requise");
  assertScope(dependencies, context.scope);
  const result = await dependencies.syncMutationById(rebased.mutationId);
  assertScope(dependencies, context.scope);
  if (result.state !== "COMPLETED" || result.applied !== 1 || result.conflicts !== 0) throw new CrudConflictResolutionError("REBASED_SYNC_FAILED", "La version locale n’a pas été appliquée");
  const finalMetadata = await dependencies.outbox.getMetadata(context.entityType, context.entityId);
  if (!finalMetadata || finalMetadata.revision !== context.cloud.revision + 1) throw new CrudConflictResolutionError("FINAL_SIDECAR_INVALID", "Révision locale finale invalide");
  await dependencies.outbox.removeMany(context.historical.map(({ mutationId }) => mutationId));
  await dependencies.issues.remove(context.entityType, context.entityId);
  return { entityType: context.entityType, entityId: context.entityId, newMutationId: rebased.mutationId, finalRevision: finalMetadata.revision } as const;
}

export async function resolveCrudConflictServerWins(entityType: string, entityId: string, dependencies: CrudConflictResolutionDependencies) {
  const context = await confirmedContext(entityType, entityId, dependencies);
  if (!await dependencies.applyCloudLocally(context.entityType, context.entityId, context.cloud)) throw new CrudConflictResolutionError("LOCAL_APPLY_FAILED", "La version Cloud n’a pas pu être enregistrée localement");
  assertScope(dependencies, context.scope);
  const metadata: StoredSyncMetadata = { entityType: context.entityType, entityId: context.entityId, revision: context.cloud.revision, updatedAt: context.cloud.updatedAt, ...(context.cloud.deletedAt ? { deletedAt: context.cloud.deletedAt } : {}) };
  await dependencies.outbox.setMetadata(metadata);
  await dependencies.outbox.removeMany(context.historical.map(({ mutationId }) => mutationId));
  await dependencies.issues.remove(context.entityType, context.entityId);
  return { entityType: context.entityType, entityId: context.entityId, revision: context.cloud.revision, deleted: Boolean(context.cloud.deletedAt) } as const;
}
