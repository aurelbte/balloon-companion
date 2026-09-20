import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudSyncIssueRepository, CloudSyncPassResult, CloudSyncPayload } from "./cloudSyncService.ts";
import type { SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const PROTECTED_PREFERENCE_REBASE_TYPES = Object.freeze(["weather-preferences", "unit-preferences", "aviation-preferences"] as const);
export type ProtectedPreferenceRebaseType = typeof PROTECTED_PREFERENCE_REBASE_TYPES[number];
export type ProtectedPreferenceCloudState = Readonly<{ revision: number; updatedAt: string; deletedAt: string | null; payload: CloudSyncPayload; value: unknown }>;
export type ProtectedPreferenceConflictRebaseDependencies = Readonly<{
  outbox: SyncOutboxStorage;
  issues: Pick<CloudSyncIssueRepository, "list" | "remove">;
  getScope(): LocalDataScope | null;
  hasPendingIntent(entityType: ProtectedPreferenceRebaseType): boolean | Promise<boolean>;
  readCloudState(entityType: ProtectedPreferenceRebaseType): Promise<ProtectedPreferenceCloudState | null>;
  buildPayload(mutation: SyncMutation): Promise<CloudSyncPayload | null>;
  applyCloudLocally(entityType: ProtectedPreferenceRebaseType, cloud: ProtectedPreferenceCloudState): boolean | Promise<boolean>;
  syncMutationById(mutationId: string): Promise<CloudSyncPassResult>;
}>;
export class ProtectedPreferenceConflictRebaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProtectedPreferenceConflictRebaseError"; this.code = code; }
}
const TARGETS: Readonly<Record<ProtectedPreferenceRebaseType, Readonly<{ entityType: string; entityId: string; requiredPayloadKey: string }>>> = {
  "weather-preferences": { entityType: "user_preferences", entityId: "weather", requiredPayloadKey: "preferences" },
  "unit-preferences": { entityType: "user_preferences", entityId: "units", requiredPayloadKey: "preferences" },
  "aviation-preferences": { entityType: "aviation_preferences", entityId: "aviation", requiredPayloadKey: "favorites" },
};
function asType(value: string): ProtectedPreferenceRebaseType {
  if (!PROTECTED_PREFERENCE_REBASE_TYPES.includes(value as ProtectedPreferenceRebaseType)) throw new ProtectedPreferenceConflictRebaseError("DOMAIN_NOT_ALLOWED", "Domaine non autorisé");
  return value as ProtectedPreferenceRebaseType;
}
function userScope(value: LocalDataScope | null): value is `USER:${string}` { return typeof value === "string" && value.startsWith("USER:") && value.length > 5; }
function assertScope(deps: ProtectedPreferenceConflictRebaseDependencies, expected: `USER:${string}`) {
  if (deps.getScope() !== expected) throw new ProtectedPreferenceConflictRebaseError("USER_SWITCH", "Le compte actif a changé");
}
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return `${typeof value}:${JSON.stringify(value)}`;
}
function assertPayload(type: ProtectedPreferenceRebaseType, payload: CloudSyncPayload | null): asserts payload is CloudSyncPayload {
  const target = TARGETS[type];
  if (!payload || payload.serverEntityType !== target.entityType || payload.serverEntityId !== target.entityId || !payload.payload || typeof payload.payload !== "object" || !(target.requiredPayloadKey in payload.payload)) {
    throw new ProtectedPreferenceConflictRebaseError("INVALID_LOCAL_PAYLOAD", "Les préférences ne peuvent pas être validées");
  }
}
function assertCloud(type: ProtectedPreferenceRebaseType, cloud: ProtectedPreferenceCloudState | null): asserts cloud is ProtectedPreferenceCloudState {
  if (!cloud) throw new ProtectedPreferenceConflictRebaseError("CLOUD_ROW_NOT_FOUND", "Préférences Cloud absentes");
  if (cloud.deletedAt) throw new ProtectedPreferenceConflictRebaseError("CLOUD_TOMBSTONE", "Préférences Cloud supprimées");
  if (!Number.isInteger(cloud.revision) || cloud.revision < 0 || !cloud.updatedAt) throw new ProtectedPreferenceConflictRebaseError("INVALID_CLOUD_STATE", "État Cloud invalide");
  assertPayload(type, cloud.payload);
}
type Context = Readonly<{ type: ProtectedPreferenceRebaseType; scope: `USER:${string}`; historical: readonly SyncMutation[]; local: CloudSyncPayload; localFingerprint: string }>;
async function prepare(typeValue: string, deps: ProtectedPreferenceConflictRebaseDependencies): Promise<Context> {
  const type = asType(typeValue), scope = deps.getScope();
  if (!userScope(scope)) throw new ProtectedPreferenceConflictRebaseError("USER_REQUIRED", "Connexion requise");
  const candidates = (await deps.outbox.list()).filter(m => m.entityType === type && m.entityId === "singleton");
  const historical = candidates.filter(m => m.lastErrorCode === "CONFLICT" && m.attempts > 0);
  if (!historical.length) throw new ProtectedPreferenceConflictRebaseError("NO_CONFIRMED_CONFLICT", "Aucun conflit confirmé");
  if (candidates.some(m => m.attempts === 0)) throw new ProtectedPreferenceConflictRebaseError("UNATTEMPTED_MUTATION_PRESENT", "Une modification attend encore son premier envoi");
  if (candidates.length !== historical.length) throw new ProtectedPreferenceConflictRebaseError("CHAIN_NOT_STABLE", "Une autre tentative doit finir avant la résolution");
  if (await deps.hasPendingIntent(type)) throw new ProtectedPreferenceConflictRebaseError("PENDING_INTENT", "Une écriture locale attend son transfert durable");
  const local = await deps.buildPayload(historical.at(-1)!); assertPayload(type, local); assertScope(deps, scope);
  return { type, scope, historical, local, localFingerprint: canonical(local) };
}
async function assertUnchanged(context: Context, deps: ProtectedPreferenceConflictRebaseDependencies, includeMutationId?: string): Promise<void> {
  assertScope(deps, context.scope);
  if (await deps.hasPendingIntent(context.type)) throw new ProtectedPreferenceConflictRebaseError("PENDING_INTENT", "Une nouvelle écriture locale attend son transfert");
  const expected = new Set([...context.historical.map(m => m.mutationId), ...(includeMutationId ? [includeMutationId] : [])]);
  const current = (await deps.outbox.list()).filter(m => m.entityType === context.type && m.entityId === "singleton");
  if (current.length !== expected.size || current.some(m => !expected.has(m.mutationId))) throw new ProtectedPreferenceConflictRebaseError("CHAIN_CHANGED", "La chaîne a changé pendant la résolution");
  const local = await deps.buildPayload(context.historical.at(-1)!); assertPayload(context.type, local);
  if (canonical(local) !== context.localFingerprint) throw new ProtectedPreferenceConflictRebaseError("LOCAL_CHANGED", "Les préférences locales ont changé");
}
async function cleanup(context: Context, deps: ProtectedPreferenceConflictRebaseDependencies): Promise<void> {
  const historicalIds = new Set(context.historical.map(m => m.mutationId));
  const anotherConflict = (await deps.outbox.list()).some(m => m.entityType === context.type && m.entityId === "singleton" && m.lastErrorCode === "CONFLICT" && !historicalIds.has(m.mutationId));
  // If the two stores cannot be committed together, remove the diagnostic first:
  // a crash still leaves the durable CONFLICT mutations visible to C1 and retryable.
  if (!anotherConflict) await deps.issues.remove(context.type, "singleton");
  await deps.outbox.removeMany([...historicalIds]);
}
export async function resolveProtectedPreferenceConflictLocalWins(typeValue: string, deps: ProtectedPreferenceConflictRebaseDependencies) {
  const context = await prepare(typeValue, deps);
  let cloud: ProtectedPreferenceCloudState | null;
  try { cloud = await deps.readCloudState(context.type); } catch { throw new ProtectedPreferenceConflictRebaseError("CLOUD_READ_FAILED", "Lecture Cloud impossible"); }
  assertScope(deps, context.scope); assertCloud(context.type, cloud); await assertUnchanged(context, deps);
  if (canonical(cloud.payload) === context.localFingerprint) {
    await deps.outbox.setMetadata({ entityType: context.type, entityId: "singleton", revision: cloud.revision, updatedAt: cloud.updatedAt });
    await assertUnchanged(context, deps); await cleanup(context, deps);
    return { entityType: context.type, newMutationId: null, removedHistoricalMutationIds: context.historical.map(m => m.mutationId), finalRevision: cloud.revision } as const;
  }
  await deps.outbox.setMetadata({ entityType: context.type, entityId: "singleton", revision: cloud.revision, updatedAt: cloud.updatedAt });
  await assertUnchanged(context, deps);
  const rebased = await deps.outbox.enqueueFresh({ entityType: context.type, entityId: "singleton", operation: "UPSERT", baseRevision: cloud.revision });
  await assertUnchanged(context, deps, rebased.mutationId);
  const result = await deps.syncMutationById(rebased.mutationId);
  assertScope(deps, context.scope);
  if (result.state !== "COMPLETED" || result.applied !== 1 || result.conflicts || result.notFound || result.ignored) throw new ProtectedPreferenceConflictRebaseError("REBASED_SYNC_FAILED", "La version locale n’a pas été confirmée");
  const final = await deps.outbox.getMetadata(context.type, "singleton");
  if (!final || final.revision !== cloud.revision + 1 || final.deletedAt) throw new ProtectedPreferenceConflictRebaseError("FINAL_SIDECAR_INVALID", "Révision locale finale invalide");
  await assertUnchanged(context, deps);
  await cleanup(context, deps);
  return { entityType: context.type, newMutationId: rebased.mutationId, removedHistoricalMutationIds: context.historical.map(m => m.mutationId), finalRevision: final.revision } as const;
}
export async function resolveProtectedPreferenceConflictCloudWins(typeValue: string, deps: ProtectedPreferenceConflictRebaseDependencies) {
  const context = await prepare(typeValue, deps);
  let cloud: ProtectedPreferenceCloudState | null;
  try { cloud = await deps.readCloudState(context.type); } catch { throw new ProtectedPreferenceConflictRebaseError("CLOUD_READ_FAILED", "Lecture Cloud impossible"); }
  assertScope(deps, context.scope); assertCloud(context.type, cloud); await assertUnchanged(context, deps);
  if (!await deps.applyCloudLocally(context.type, cloud)) throw new ProtectedPreferenceConflictRebaseError("LOCAL_APPLY_FAILED", "Les préférences Cloud n’ont pas pu être enregistrées");
  assertScope(deps, context.scope);
  const persisted = await deps.buildPayload(context.historical.at(-1)!); assertPayload(context.type, persisted);
  if (canonical(persisted) !== canonical(cloud.payload)) throw new ProtectedPreferenceConflictRebaseError("LOCAL_VERIFY_FAILED", "La version Cloud enregistrée n’a pas pu être vérifiée");
  if (await deps.hasPendingIntent(context.type)) throw new ProtectedPreferenceConflictRebaseError("PENDING_INTENT", "Une écriture concurrente doit être conservée");
  const current = (await deps.outbox.list()).filter(m => m.entityType === context.type && m.entityId === "singleton");
  const expected = new Set(context.historical.map(m => m.mutationId));
  if (current.length !== expected.size || current.some(m => !expected.has(m.mutationId))) throw new ProtectedPreferenceConflictRebaseError("CHAIN_CHANGED", "Une nouvelle écriture locale est apparue");
  await deps.outbox.setMetadata({ entityType: context.type, entityId: "singleton", revision: cloud.revision, updatedAt: cloud.updatedAt });
  assertScope(deps, context.scope);
  if (await deps.hasPendingIntent(context.type)) throw new ProtectedPreferenceConflictRebaseError("PENDING_INTENT", "Une écriture concurrente doit être conservée");
  const finalLocal = await deps.buildPayload(context.historical.at(-1)!); assertPayload(context.type, finalLocal);
  if (canonical(finalLocal) !== canonical(cloud.payload)) throw new ProtectedPreferenceConflictRebaseError("LOCAL_CHANGED", "Les préférences locales ont changé");
  const finalCandidates = (await deps.outbox.list()).filter(m => m.entityType === context.type && m.entityId === "singleton");
  if (finalCandidates.length !== expected.size || finalCandidates.some(m => !expected.has(m.mutationId))) throw new ProtectedPreferenceConflictRebaseError("CHAIN_CHANGED", "Une nouvelle écriture locale est apparue");
  await cleanup(context, deps);
  return { entityType: context.type, removedHistoricalMutationIds: context.historical.map(m => m.mutationId), finalRevision: cloud.revision } as const;
}
