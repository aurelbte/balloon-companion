import { getRuntimeDataScope, getRuntimeDataScopeGeneration } from "./auth/dataScopeRuntime.ts";
import { hasLocalStorageSyncIntent } from "./durableSyncIntent.ts";
import type { CloudSyncIssueRepository } from "./cloudSyncService.ts";
import type { SyncOutboxStorage } from "./syncOutbox.ts";

const LEGACY_ENTITY_TYPE = "flight-completion";
const LEGACY_ENTITY_ID = "singleton";

export type LegacyFlightCompletionRecoveryResult =
  | Readonly<{ state: "NONE" | "REMOVED"; removed: number }>
  | Readonly<{ state: "AMBIGUOUS" | "OBSOLETE"; removed: 0 }>;

export async function recoverLegacyFlightCompletionMutation(input: Readonly<{
  storage: Storage;
  scope: `USER:${string}`;
  outbox: Pick<SyncOutboxStorage, "list" | "removeManyIfUnchanged"> & { getScope(): string | null };
  issues: Pick<CloudSyncIssueRepository, "list">;
  getScope?: typeof getRuntimeDataScope;
  getGeneration?: typeof getRuntimeDataScopeGeneration;
}>): Promise<LegacyFlightCompletionRecoveryResult> {
  const getScope = input.getScope ?? getRuntimeDataScope;
  const getGeneration = input.getGeneration ?? getRuntimeDataScopeGeneration;
  const generation = getGeneration();
  const current = () => getScope() === input.scope && getGeneration() === generation && input.outbox.getScope() === input.scope;
  if (!current()) return { state: "OBSOLETE", removed: 0 };

  const mutations = (await input.outbox.list()).filter(({ entityType, entityId }) =>
    entityType === LEGACY_ENTITY_TYPE && entityId === LEGACY_ENTITY_ID,
  );
  if (!mutations.length) return { state: "NONE", removed: 0 };
  if (!current()) return { state: "OBSOLETE", removed: 0 };

  const hasSnapshotOrIntent = mutations.some((mutation) =>
    mutation.payloadSnapshot != null || (mutation.durableIntentIds?.length ?? 0) > 0,
  );
  let hasStoredIntent = true;
  try {
    hasStoredIntent = hasLocalStorageSyncIntent(input.storage, input.scope, LEGACY_ENTITY_TYPE, LEGACY_ENTITY_ID);
  } catch {
    return { state: "AMBIGUOUS", removed: 0 };
  }
  const hasDiagnostic = (await input.issues.list()).some(({ entityType, entityId }) =>
    entityType === LEGACY_ENTITY_TYPE && entityId === LEGACY_ENTITY_ID,
  );
  if (!current()) return { state: "OBSOLETE", removed: 0 };
  if (hasSnapshotOrIntent || hasStoredIntent || hasDiagnostic) return { state: "AMBIGUOUS", removed: 0 };

  if (!await input.outbox.removeManyIfUnchanged(mutations)) return { state: "AMBIGUOUS", removed: 0 };
  if (!current()) return { state: "OBSOLETE", removed: 0 };
  return { state: "REMOVED", removed: mutations.length };
}
