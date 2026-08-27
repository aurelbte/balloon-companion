import type { LocalDataScope } from "./auth/dataScope.ts";
import type { SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export type CloudBackfillCandidate = Readonly<{ entityType: string; entityId: string }>;
export type CloudBackfillState = "COMPLETED" | "OFFLINE" | "SESSION_INVALID" | "STOPPED_ERROR";
export type CloudBackfillReport = Readonly<{
  state: CloudBackfillState;
  scanned: number;
  enqueued: number;
  pendingPreserved: number;
  knownPreserved: number;
  cloudExistingPreserved: number;
}>;

type Dependencies = Readonly<{
  scope: `USER:${string}`;
  getScope(): LocalDataScope | null;
  isOnline(): boolean;
  getOnlineUserId(): Promise<string | null>;
  listCandidates(): Promise<readonly CloudBackfillCandidate[]>;
  findExistingCloud(candidates: readonly CloudBackfillCandidate[]): Promise<ReadonlySet<string>>;
  outbox: Pick<SyncOutboxStorage, "list" | "getMetadata" | "enqueue">;
}>;

export function cloudBackfillKey(candidate: CloudBackfillCandidate): string {
  return `${candidate.entityType}\u0000${candidate.entityId}`;
}

export class CloudBackfillService {
  private readonly dependencies: Dependencies;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }

  async run(): Promise<CloudBackfillReport> {
    const empty = { scanned: 0, enqueued: 0, pendingPreserved: 0, knownPreserved: 0, cloudExistingPreserved: 0 };
    const userId = this.dependencies.scope.slice(5);
    if (this.dependencies.getScope() !== this.dependencies.scope) return { state: "SESSION_INVALID", ...empty };
    if (!this.dependencies.isOnline()) return { state: "OFFLINE", ...empty };
    if (await this.dependencies.getOnlineUserId().catch(() => null) !== userId) return { state: "SESSION_INVALID", ...empty };
    try {
      const candidates = await this.dependencies.listCandidates();
      const mutations = await this.dependencies.outbox.list();
      const pending = new Set(mutations.map((mutation: SyncMutation) => cloudBackfillKey(mutation)));
      let pendingPreserved = 0;
      let knownPreserved = 0;
      const unknown: CloudBackfillCandidate[] = [];
      for (const candidate of candidates) {
        if (pending.has(cloudBackfillKey(candidate))) { pendingPreserved += 1; continue; }
        if (await this.dependencies.outbox.getMetadata(candidate.entityType, candidate.entityId)) { knownPreserved += 1; continue; }
        unknown.push(candidate);
      }
      const existingCloud = await this.dependencies.findExistingCloud(unknown);
      let enqueued = 0;
      let cloudExistingPreserved = 0;
      for (const candidate of unknown) {
        if (!this.dependencies.isOnline()) return { state: "OFFLINE", scanned: candidates.length, enqueued, pendingPreserved, knownPreserved, cloudExistingPreserved };
        if (this.dependencies.getScope() !== this.dependencies.scope) {
          return { state: "SESSION_INVALID", scanned: candidates.length, enqueued, pendingPreserved, knownPreserved, cloudExistingPreserved };
        }
        if (existingCloud.has(cloudBackfillKey(candidate))) { cloudExistingPreserved += 1; continue; }
        await this.dependencies.outbox.enqueue({ entityType: candidate.entityType, entityId: candidate.entityId, operation: "UPSERT", baseRevision: 0 });
        enqueued += 1;
      }
      return { state: "COMPLETED", scanned: candidates.length, enqueued, pendingPreserved, knownPreserved, cloudExistingPreserved };
    } catch {
      return { state: this.dependencies.isOnline() ? "STOPPED_ERROR" : "OFFLINE", ...empty };
    }
  }
}
