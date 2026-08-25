import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudSyncIssueRepository, CloudSyncPassResult, CloudSyncPayload } from "./cloudSyncService.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const CRUD_CONFLICT_ENTITY_TYPES = Object.freeze([
  "favorite-weather-place", "favorite-launch-site", "balloon", "flight", "logbook-entry", "balloon-document",
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
  syncMutationById(mutationId: string): Promise<CloudSyncPassResult>;
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

async function confirmedContext(entityType: string, entityId: string, dependencies: CrudConflictResolutionDependencies) {
  if (!allowed(entityType)) throw new CrudConflictResolutionError("DOMAIN_NOT_ALLOWED", "Domaine CRUD non autorisé");
  const scope = dependencies.getScope();
  if (!userScope(scope)) throw new CrudConflictResolutionError("USER_REQUIRED", "Utilisateur connecté requis");
  if (await dependencies.getOnlineUserId().catch(() => null) !== scope.slice(5)) throw new CrudConflictResolutionError("OFFLINE_OR_SESSION_INVALID", "Session Cloud indisponible");
  assertScope(dependencies, scope);
  const issue = (await dependencies.issues.list()).find((candidate) => candidate.kind === "CONFLICT" && candidate.entityType === entityType && candidate.entityId === entityId);
  const historical = (await dependencies.outbox.list()).filter((mutation) => mutation.entityType === entityType && mutation.entityId === entityId);
  if (!issue || historical.length === 0) throw new CrudConflictResolutionError("CONFLICT_NOT_FOUND", "Ce conflit n’est plus présent");
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
