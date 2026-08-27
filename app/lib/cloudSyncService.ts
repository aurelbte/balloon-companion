import type { LocalDataScope } from "./auth/dataScope.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const PHASE_3A_SYNC_ENTITY_TYPES = Object.freeze([
  "pilot-profile",
  "unit-preferences",
  "weather-preferences",
  "aviation-preferences",
  "pilot-qualifications",
  "favorite-launch-site",
  "favorite-weather-place",
] as const);

export type Phase3ASyncEntityType = typeof PHASE_3A_SYNC_ENTITY_TYPES[number];
export const AUTOMATIC_SYNC_ENTITY_TYPES = Object.freeze([...PHASE_3A_SYNC_ENTITY_TYPES, "balloon", "balloon-preferences", "flight", "logbook-entry", "balloon-document"] as const);
export const PHASE_3B_TARGETED_SYNC_ENTITY_TYPES = AUTOMATIC_SYNC_ENTITY_TYPES;
export type CloudMutationStatus = "APPLIED" | "ALREADY_APPLIED" | "CONFLICT" | "NOT_FOUND";

export type CloudMutationRequest = Readonly<{
  mutationId: string;
  entityType: string;
  entityId: string;
  operation: "UPSERT" | "DELETE";
  baseRevision: number;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CloudMutationResult = Readonly<{
  status: CloudMutationStatus;
  entityId: string;
  revision: number | null;
  serverUpdatedAt: string | null;
  deletedAt: string | null;
}>;

export type CloudSyncIssue = Readonly<{
  kind: "CONFLICT" | "NOT_FOUND";
  entityType: string;
  entityId: string;
  mutation: SyncMutation;
  serverRevision: number | null;
  serverUpdatedAt: string | null;
  serverDeletedAt: string | null;
  recordedAt: string;
}>;

export interface CloudSyncIssueRepository {
  save(issue: CloudSyncIssue): Promise<void>;
  remove(entityType: string, entityId: string): Promise<void>;
  list(): Promise<readonly CloudSyncIssue[]>;
}

export class MemoryCloudSyncIssueRepository implements CloudSyncIssueRepository {
  private readonly issues = new Map<string, CloudSyncIssue>();
  async save(issue: CloudSyncIssue): Promise<void> { this.issues.set(`${issue.entityType}\u0000${issue.entityId}`, issue); }
  async remove(entityType: string, entityId: string): Promise<void> { this.issues.delete(`${entityType}\u0000${entityId}`); }
  async list(): Promise<readonly CloudSyncIssue[]> { return [...this.issues.values()]; }
}

export class CloudSyncTransportError extends Error {
  readonly kind: "AUTH" | "NETWORK" | "SERVER";
  constructor(kind: "AUTH" | "NETWORK" | "SERVER", message: string) {
    super(message);
    this.name = "CloudSyncTransportError";
    this.kind = kind;
  }
}

export type CloudSyncPayload = Readonly<{
  serverEntityType: string;
  serverEntityId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CloudSyncDependencies = Readonly<{
  outbox: SyncOutboxStorage;
  issues: CloudSyncIssueRepository;
  getScope(): LocalDataScope | null;
  getOnlineUserId(): Promise<string | null>;
  buildPayload(mutation: SyncMutation): Promise<CloudSyncPayload | null>;
  applyMutation(request: CloudMutationRequest): Promise<CloudMutationResult>;
  now?: () => Date;
}>;

export type CloudSyncPassResult = Readonly<{
  state: "COMPLETED" | "SKIPPED_GUEST" | "SKIPPED_NO_ONLINE_SESSION" | "STOPPED_USER_SWITCH" | "STOPPED_ERROR";
  applied: number;
  conflicts: number;
  notFound: number;
  ignored: number;
}>;

const AUTOMATIC_ALLOWED_TYPES = new Set<string>(AUTOMATIC_SYNC_ENTITY_TYPES);
const TARGETED_ALLOWED_TYPES = new Set<string>(PHASE_3B_TARGETED_SYNC_ENTITY_TYPES);
const AUTOMATIC_TYPE_PRIORITY = new Map<string, number>(AUTOMATIC_SYNC_ENTITY_TYPES.map((entityType, index) => [entityType, index]));
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const BASE_BACKOFF_MS = 5 * 1000;

export function cloudSyncBackoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

function userIdFromScope(scope: LocalDataScope | null): string | null {
  return scope?.startsWith("USER:") ? scope.slice(5) : null;
}

function isEligible(mutation: SyncMutation, now: Date): boolean {
  if (mutation.lastErrorCode === "CONFLICT") return false;
  return !mutation.nextAttemptAt || Date.parse(mutation.nextAttemptAt) <= now.getTime();
}

export function nextEligibleRetryAt(mutations: readonly SyncMutation[]): string | null {
  let next: number | null = null;
  for (const mutation of mutations) {
    if (!AUTOMATIC_ALLOWED_TYPES.has(mutation.entityType) || mutation.lastErrorCode === "CONFLICT" || !mutation.nextAttemptAt) continue;
    const timestamp = Date.parse(mutation.nextAttemptAt);
    if (Number.isFinite(timestamp) && (next === null || timestamp < next)) next = timestamp;
  }
  return next === null ? null : new Date(next).toISOString();
}

export class CloudSyncService {
  private readonly dependencies: CloudSyncDependencies;
  constructor(dependencies: CloudSyncDependencies) { this.dependencies = dependencies; }

  async syncPendingMutations(): Promise<CloudSyncPassResult> {
    const authorization = await this.authorizePass();
    if ("state" in authorization) return authorization;
    const mutations = (await this.dependencies.outbox.list()).map((mutation, index) => ({ mutation, index }))
      .sort((left, right) => (AUTOMATIC_TYPE_PRIORITY.get(left.mutation.entityType) ?? Number.MAX_SAFE_INTEGER)
        - (AUTOMATIC_TYPE_PRIORITY.get(right.mutation.entityType) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
      .map(({ mutation }) => mutation);
    return this.processMutations(mutations, authorization, AUTOMATIC_ALLOWED_TYPES);
  }

  async syncMutationById(mutationId: string): Promise<CloudSyncPassResult> {
    const authorization = await this.authorizePass();
    if ("state" in authorization) return authorization;
    const mutation = (await this.dependencies.outbox.list()).find((candidate) => candidate.mutationId === mutationId);
    if (!mutation) return this.result("COMPLETED");
    return this.processMutations([mutation], authorization, TARGETED_ALLOWED_TYPES);
  }

  private async authorizePass(): Promise<Readonly<{ scope: `USER:${string}`; userId: string }> | CloudSyncPassResult> {
    const initialScope = this.dependencies.getScope();
    if (initialScope === "GUEST") return this.result("SKIPPED_GUEST");
    const expectedUserId = userIdFromScope(initialScope);
    if (!expectedUserId) return this.result("SKIPPED_NO_ONLINE_SESSION");
    let onlineUserId: string | null;
    try { onlineUserId = await this.dependencies.getOnlineUserId(); }
    catch { return this.result("SKIPPED_NO_ONLINE_SESSION"); }
    if (!onlineUserId || onlineUserId !== expectedUserId) return this.result("SKIPPED_NO_ONLINE_SESSION");
    return { scope: initialScope as `USER:${string}`, userId: expectedUserId };
  }

  private async processMutations(
    mutations: readonly SyncMutation[],
    authorization: Readonly<{ scope: `USER:${string}`; userId: string }>,
    allowedTypes: ReadonlySet<string>,
  ): Promise<CloudSyncPassResult> {
    const counters = { applied: 0, conflicts: 0, notFound: 0, ignored: 0 };
    const now = (this.dependencies.now ?? (() => new Date()))();

    for (const candidate of mutations) {
      if (!allowedTypes.has(candidate.entityType)) { counters.ignored += 1; continue; }
      if (!isEligible(candidate, now)) continue;
      if (!this.sameUser(authorization.scope, authorization.userId)) return { state: "STOPPED_USER_SWITCH", ...counters };

      const payload = await this.dependencies.buildPayload(candidate);
      if (!payload && candidate.operation === "UPSERT") {
        const attempted = await this.dependencies.outbox.markAttempt(candidate.mutationId);
        if (attempted) await this.scheduleRetry(attempted, "LOCAL_PAYLOAD_NOT_FOUND", now);
        return { state: "STOPPED_ERROR", ...counters };
      }

      const attempted = await this.dependencies.outbox.markAttempt(candidate.mutationId);
      if (!attempted) continue;
      try {
        const response = await this.dependencies.applyMutation({
          mutationId: attempted.mutationId,
          entityType: payload?.serverEntityType ?? candidate.entityType,
          entityId: payload?.serverEntityId ?? candidate.entityId,
          operation: attempted.operation,
          baseRevision: attempted.baseRevision,
          payload: attempted.operation === "DELETE" ? {} : payload?.payload ?? {},
        });
        if (!this.sameUser(authorization.scope, authorization.userId)) return { state: "STOPPED_USER_SWITCH", ...counters };

        if (response.status === "APPLIED" || response.status === "ALREADY_APPLIED") {
          if (response.revision === null || !response.serverUpdatedAt) throw new CloudSyncTransportError("SERVER", "Successful mutation response is incomplete");
          const metadata: StoredSyncMetadata = {
            entityType: attempted.entityType,
            entityId: attempted.entityId,
            revision: response.revision,
            updatedAt: response.serverUpdatedAt,
            ...(response.deletedAt ? { deletedAt: response.deletedAt } : {}),
          };
          await this.dependencies.outbox.setMetadata(metadata);
          await this.dependencies.issues.remove(attempted.entityType, attempted.entityId);
          await this.dependencies.outbox.remove(attempted.mutationId);
          counters.applied += 1;
          continue;
        }

        await this.dependencies.issues.save({
          kind: response.status,
          entityType: attempted.entityType,
          entityId: attempted.entityId,
          mutation: attempted,
          serverRevision: response.revision,
          serverUpdatedAt: response.serverUpdatedAt,
          serverDeletedAt: response.deletedAt,
          recordedAt: now.toISOString(),
        });
        if (response.status === "CONFLICT") {
          await this.dependencies.outbox.updateMutation(attempted.mutationId, { lastErrorCode: "CONFLICT" });
          counters.conflicts += 1;
          continue;
        }

        // NOT_FOUND is terminal for this mutation in V1: preserve a diagnostic issue,
        // then remove it to avoid an infinite retry loop.
        await this.dependencies.outbox.remove(attempted.mutationId);
        counters.notFound += 1;
      } catch (error) {
        if (error instanceof CloudSyncTransportError && error.kind === "AUTH") {
          return { state: "SKIPPED_NO_ONLINE_SESSION", ...counters };
        }
        await this.scheduleRetry(attempted, error instanceof CloudSyncTransportError ? error.kind : "NETWORK", now);
        return { state: "STOPPED_ERROR", ...counters };
      }
    }
    return { state: "COMPLETED", ...counters };
  }

  private sameUser(scope: LocalDataScope, userId: string): boolean {
    const current = this.dependencies.getScope();
    return current === scope && userIdFromScope(current) === userId;
  }

  private async scheduleRetry(mutation: SyncMutation, code: string, now: Date): Promise<void> {
    await this.dependencies.outbox.updateMutation(mutation.mutationId, {
      lastErrorCode: code,
      nextAttemptAt: new Date(now.getTime() + cloudSyncBackoffMs(mutation.attempts)).toISOString(),
    });
  }

  private result(state: CloudSyncPassResult["state"]): CloudSyncPassResult {
    return { state, applied: 0, conflicts: 0, notFound: 0, ignored: 0 };
  }
}
