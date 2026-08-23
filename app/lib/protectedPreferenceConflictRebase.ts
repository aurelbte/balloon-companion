import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudSyncPassResult, CloudSyncPayload } from "./cloudSyncService.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const PROTECTED_PREFERENCE_REBASE_TYPES = Object.freeze([
  "weather-preferences",
  "unit-preferences",
  "aviation-preferences",
] as const);

export type ProtectedPreferenceRebaseType = typeof PROTECTED_PREFERENCE_REBASE_TYPES[number];

export type ProtectedPreferenceCloudState = Readonly<{
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type ProtectedPreferenceConflictRebaseDependencies = Readonly<{
  outbox: SyncOutboxStorage;
  getScope(): LocalDataScope | null;
  readCloudState(entityType: ProtectedPreferenceRebaseType): Promise<ProtectedPreferenceCloudState | null>;
  buildPayload(mutation: SyncMutation): Promise<CloudSyncPayload | null>;
  syncMutationById(mutationId: string): Promise<CloudSyncPassResult>;
}>;

export class ProtectedPreferenceConflictRebaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProtectedPreferenceConflictRebaseError"; this.code = code; }
}

const SERVER_TARGETS: Readonly<Record<ProtectedPreferenceRebaseType, Readonly<{ entityType: string; entityId: string; requiredPayloadKey: string }>>> = {
  "weather-preferences": { entityType: "user_preferences", entityId: "weather", requiredPayloadKey: "preferences" },
  "unit-preferences": { entityType: "user_preferences", entityId: "units", requiredPayloadKey: "preferences" },
  "aviation-preferences": { entityType: "aviation_preferences", entityId: "aviation", requiredPayloadKey: "favorites" },
};

function currentUserScope(scope: LocalDataScope | null): scope is `USER:${string}` {
  return typeof scope === "string" && scope.startsWith("USER:") && scope.length > 5;
}

function assertScope(dependencies: ProtectedPreferenceConflictRebaseDependencies, expected: `USER:${string}`): void {
  if (dependencies.getScope() !== expected) throw new ProtectedPreferenceConflictRebaseError("USER_SWITCH", "Le scope USER a changé");
}

function assertPayload(entityType: ProtectedPreferenceRebaseType, payload: CloudSyncPayload | null): asserts payload is CloudSyncPayload {
  const target = SERVER_TARGETS[entityType];
  if (!payload || payload.serverEntityType !== target.entityType || payload.serverEntityId !== target.entityId ||
      !payload.payload || typeof payload.payload !== "object" || !(target.requiredPayloadKey in payload.payload)) {
    throw new ProtectedPreferenceConflictRebaseError("INVALID_LOCAL_PAYLOAD", "Le snapshot local courant est invalide");
  }
}

export async function resolveProtectedPreferenceConflictLocalWins(
  requestedEntityType: string,
  dependencies: ProtectedPreferenceConflictRebaseDependencies,
): Promise<Readonly<{ entityType: ProtectedPreferenceRebaseType; newMutationId: string; removedHistoricalMutationIds: readonly string[]; finalRevision: number }>> {
  if (!PROTECTED_PREFERENCE_REBASE_TYPES.includes(requestedEntityType as ProtectedPreferenceRebaseType)) {
    throw new ProtectedPreferenceConflictRebaseError("DOMAIN_NOT_ALLOWED", "Domaine non autorisé pour le rebase");
  }
  const entityType = requestedEntityType as ProtectedPreferenceRebaseType;
  const initialScope = dependencies.getScope();
  if (!currentUserScope(initialScope)) throw new ProtectedPreferenceConflictRebaseError("USER_REQUIRED", "Scope USER requis");

  const candidates = (await dependencies.outbox.list()).filter((mutation) =>
    mutation.entityType === entityType && mutation.entityId === "singleton",
  );
  const historical = candidates.filter((mutation) => mutation.lastErrorCode === "CONFLICT" && mutation.attempts > 0);
  if (historical.length === 0) throw new ProtectedPreferenceConflictRebaseError("NO_CONFIRMED_CONFLICT", "Aucune mutation en conflit confirmée");
  if (candidates.some((mutation) => mutation.attempts === 0)) {
    throw new ProtectedPreferenceConflictRebaseError("UNATTEMPTED_MUTATION_PRESENT", "Une mutation non tentée empêcherait la création d’une mutation distincte");
  }

  let cloud: ProtectedPreferenceCloudState | null;
  try { cloud = await dependencies.readCloudState(entityType); }
  catch { throw new ProtectedPreferenceConflictRebaseError("CLOUD_READ_FAILED", "Lecture Cloud impossible"); }
  assertScope(dependencies, initialScope);
  if (!cloud) throw new ProtectedPreferenceConflictRebaseError("CLOUD_ROW_NOT_FOUND", "Ligne Cloud absente");
  if (cloud.deletedAt) throw new ProtectedPreferenceConflictRebaseError("CLOUD_TOMBSTONE", "Le singleton Cloud possède un tombstone");
  if (!Number.isInteger(cloud.revision) || cloud.revision < 0 || !cloud.updatedAt) {
    throw new ProtectedPreferenceConflictRebaseError("INVALID_CLOUD_STATE", "État Cloud invalide");
  }

  const payload = await dependencies.buildPayload(historical.at(-1)!);
  assertPayload(entityType, payload);
  assertScope(dependencies, initialScope);

  const alignedMetadata: StoredSyncMetadata = {
    entityType,
    entityId: "singleton",
    revision: cloud.revision,
    updatedAt: cloud.updatedAt,
  };
  await dependencies.outbox.setMetadata(alignedMetadata);
  assertScope(dependencies, initialScope);
  const rebased = await dependencies.outbox.enqueue({
    entityType,
    entityId: "singleton",
    operation: "UPSERT",
    baseRevision: cloud.revision,
  });
  if (historical.some(({ mutationId }) => mutationId === rebased.mutationId) || rebased.baseRevision !== cloud.revision || rebased.attempts !== 0) {
    throw new ProtectedPreferenceConflictRebaseError("FRESH_MUTATION_REQUIRED", "La mutation rebasée n’est pas nouvelle");
  }
  assertScope(dependencies, initialScope);

  const result = await dependencies.syncMutationById(rebased.mutationId);
  if (result.state !== "COMPLETED" || result.applied !== 1 || result.conflicts !== 0 || result.notFound !== 0 || result.ignored !== 0) {
    throw new ProtectedPreferenceConflictRebaseError("REBASED_SYNC_FAILED", "La mutation rebasée n’a pas été confirmée");
  }
  assertScope(dependencies, initialScope);
  const finalMetadata = await dependencies.outbox.getMetadata(entityType, "singleton");
  if (!finalMetadata || finalMetadata.revision !== cloud.revision + 1 || finalMetadata.deletedAt) {
    throw new ProtectedPreferenceConflictRebaseError("FINAL_SIDECAR_INVALID", "Le sidecar final n’est pas aligné");
  }

  const historicalMutationIds = historical.map(({ mutationId }) => mutationId);
  await dependencies.outbox.removeMany(historicalMutationIds);
  return { entityType, newMutationId: rebased.mutationId, removedHistoricalMutationIds: historicalMutationIds, finalRevision: finalMetadata.revision };
}
