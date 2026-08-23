import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudPullCursor, CloudPullCursorRepository } from "./cloudPullState.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const FAVORITE_WEATHER_PLACE_PULL_DOMAIN = "favorite-weather-place";
export const PREFERENCE_PULL_DOMAINS = ["unit-preferences", "weather-preferences", "aviation-preferences"] as const;
export type PreferencePullDomain = typeof PREFERENCE_PULL_DOMAINS[number];
type PullDomain = typeof FAVORITE_WEATHER_PLACE_PULL_DOMAIN | PreferencePullDomain;

type CloudPullRow = Readonly<{ id: string; entityId: string; userId: string; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }>;
export type FavoriteWeatherPlaceCloudRow = Readonly<{ id: string; userId: string; syncId: string | null; name: string; latitude: number; longitude: number; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }>;
export type PreferenceCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type FavoriteWeatherPlacePullConflict = Readonly<{ entityId: string; reason: "REMOTE_ADVANCED" | "REMOTE_TOMBSTONE" | "LOCAL_CREATION_COLLISION"; cloudRevision: number; mutationId: string }>;
export type FavoriteWeatherPlacePullAnomaly = Readonly<{ entityId: string; reason: "REMOTE_REVISION_BEHIND_LOCAL" | "LOCAL_BASE_REVISION_AHEAD"; cloudRevision: number; localRevision: number }>;
export type FavoriteWeatherPlacePullReport = Readonly<{ state: "COMPLETED" | "REFUSED_GUEST" | "REFUSED_NO_SESSION" | "STOPPED_USER_SWITCH" | "STOPPED_ERROR" | "BLOCKED_ANOMALY"; fetched: number; applied: number; tombstonesApplied: number; preservedLocalPending: number; conflicts: readonly FavoriteWeatherPlacePullConflict[]; anomalies: readonly FavoriteWeatherPlacePullAnomaly[]; pages: number; cursor: CloudPullCursor | null }>;

type PullDomainAdapter<Row extends CloudPullRow> = Readonly<{ readPage(cursor: CloudPullCursor | null, limit: number): Promise<readonly Row[]>; applyLocally(row: Row): Promise<boolean> | boolean }>;
export type FavoriteWeatherPlacePullDependencies = Readonly<{
  scope: LocalDataScope | null;
  getScope(): LocalDataScope | null;
  getOnlineUserId(): Promise<string | null>;
  outbox: Pick<SyncOutboxStorage, "list" | "getMetadata" | "setMetadata">;
  cursors: CloudPullCursorRepository;
  readPage(cursor: CloudPullCursor | null, limit: number): Promise<readonly FavoriteWeatherPlaceCloudRow[]>;
  applyLocally(row: FavoriteWeatherPlaceCloudRow): Promise<boolean> | boolean;
  preferenceDomains?: Partial<Record<PreferencePullDomain, PullDomainAdapter<PreferenceCloudRow>>>;
  recordConflict(conflict: FavoriteWeatherPlacePullConflict, mutation: SyncMutation, row: CloudPullRow): Promise<void>;
}>;

function userIdFromScope(scope: LocalDataScope | null): string | null { return scope?.startsWith("USER:") ? scope.slice(5) : null; }
function emptyReport(state: FavoriteWeatherPlacePullReport["state"], cursor: CloudPullCursor | null = null): FavoriteWeatherPlacePullReport { return { state, fetched: 0, applied: 0, tombstonesApplied: 0, preservedLocalPending: 0, conflicts: [], anomalies: [], pages: 0, cursor }; }

export class CloudPullService {
  private readonly dependencies: FavoriteWeatherPlacePullDependencies;
  constructor(dependencies: FavoriteWeatherPlacePullDependencies) { this.dependencies = dependencies; }

  pullFavoriteWeatherPlaces(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> {
    return this.pullDomain(FAVORITE_WEATHER_PLACE_PULL_DOMAIN, {
      readPage: async (cursor, limit) => (await this.dependencies.readPage(cursor, limit)).map((row) => ({ ...row, entityId: row.id })),
      applyLocally: (row) => this.dependencies.applyLocally(row),
    }, pageSize);
  }
  pullUnitPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("unit-preferences", pageSize); }
  pullWeatherPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("weather-preferences", pageSize); }
  pullAviationPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("aviation-preferences", pageSize); }

  private pullPreferenceDomain(domain: PreferencePullDomain, pageSize: number): Promise<FavoriteWeatherPlacePullReport> {
    const adapter = this.dependencies.preferenceDomains?.[domain];
    return adapter ? this.pullDomain(domain, adapter, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR"));
  }

  private async pullDomain<Row extends CloudPullRow>(domain: PullDomain, adapter: PullDomainAdapter<Row>, pageSize: number): Promise<FavoriteWeatherPlacePullReport> {
    const expectedUserId = userIdFromScope(this.dependencies.scope);
    if (this.dependencies.scope === "GUEST") return emptyReport("REFUSED_GUEST");
    if (!expectedUserId || this.dependencies.getScope() !== this.dependencies.scope) return emptyReport("REFUSED_NO_SESSION");
    if (!await this.onlineUserIs(expectedUserId)) return emptyReport("REFUSED_NO_SESSION");
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Cloud pull page size must be a positive integer");
    const userScope = this.dependencies.scope as `USER:${string}`;
    let cursor = await this.dependencies.cursors.get(userScope, domain);
    let fetched = 0, applied = 0, tombstonesApplied = 0, preservedLocalPending = 0, pages = 0;
    const conflicts: FavoriteWeatherPlacePullConflict[] = [], anomalies: FavoriteWeatherPlacePullAnomaly[] = [];
    try {
      while (true) {
        if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
        const rows = await adapter.readPage(cursor, pageSize);
        pages += 1;
        if (rows.length === 0) break;
        for (const row of rows) {
          fetched += 1;
          if (!await this.onlineUserIs(expectedUserId) || row.userId !== expectedUserId) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
          const pending = (await this.dependencies.outbox.list()).filter(({ entityType, entityId }) => entityType === domain && entityId === row.entityId);
          const sidecar = await this.dependencies.outbox.getMetadata(domain, row.entityId);
          const anomaly = this.anomaly(row, sidecar, pending);
          if (anomaly) { anomalies.push(anomaly); return { state: "BLOCKED_ANOMALY", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor }; }
          const conflict = this.conflict(row, sidecar, pending);
          if (conflict) { await this.dependencies.recordConflict(conflict, pending.at(-1)!, row); conflicts.push(conflict); }
          else if (pending.length > 0) preservedLocalPending += 1;
          else {
            if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            if (!await adapter.applyLocally(row)) throw new Error("Cloud row could not be applied locally");
            if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            await this.dependencies.outbox.setMetadata({ entityType: domain, entityId: row.entityId, revision: row.revision, updatedAt: row.updatedAt, ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}) });
            applied += 1;
            if (row.deletedAt) tombstonesApplied += 1;
          }
          if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
          const nextCursor = { updatedAt: row.updatedAt, id: row.id };
          await this.dependencies.cursors.set(userScope, domain, nextCursor);
          cursor = nextCursor;
        }
        if (rows.length < pageSize) break;
      }
      return { state: "COMPLETED", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
    } catch { return { state: "STOPPED_ERROR", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor }; }
  }

  private async onlineUserIs(expectedUserId: string): Promise<boolean> {
    if (this.dependencies.getScope() !== this.dependencies.scope) return false;
    try { return await this.dependencies.getOnlineUserId() === expectedUserId; } catch { return false; }
  }
  private anomaly(row: CloudPullRow, sidecar: StoredSyncMetadata | null, pending: readonly SyncMutation[]): FavoriteWeatherPlacePullAnomaly | null {
    if (sidecar && row.revision < sidecar.revision) return { entityId: row.entityId, reason: "REMOTE_REVISION_BEHIND_LOCAL", cloudRevision: row.revision, localRevision: sidecar.revision };
    const ahead = pending.find(({ baseRevision }) => baseRevision > row.revision);
    return ahead ? { entityId: row.entityId, reason: "LOCAL_BASE_REVISION_AHEAD", cloudRevision: row.revision, localRevision: ahead.baseRevision } : null;
  }
  private conflict(row: CloudPullRow, sidecar: StoredSyncMetadata | null, pending: readonly SyncMutation[]): FavoriteWeatherPlacePullConflict | null {
    if (pending.length === 0) return null;
    const mutation = pending.at(-1)!;
    if (!sidecar) return { entityId: row.entityId, reason: "LOCAL_CREATION_COLLISION", cloudRevision: row.revision, mutationId: mutation.mutationId };
    if (row.deletedAt) return { entityId: row.entityId, reason: "REMOTE_TOMBSTONE", cloudRevision: row.revision, mutationId: mutation.mutationId };
    if (pending.some(({ baseRevision }) => baseRevision < row.revision)) return { entityId: row.entityId, reason: "REMOTE_ADVANCED", cloudRevision: row.revision, mutationId: mutation.mutationId };
    return null;
  }
}
