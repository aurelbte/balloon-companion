import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudPullCursor, CloudPullCursorRepository } from "./cloudPullState.ts";
import type { StoredSyncMetadata, SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";

export const FAVORITE_WEATHER_PLACE_PULL_DOMAIN = "favorite-weather-place";
export const FAVORITE_LAUNCH_SITE_PULL_DOMAIN = "favorite-launch-site";
export const PREFERENCE_PULL_DOMAINS = ["unit-preferences", "weather-preferences", "aviation-preferences", "pilot-qualifications", "balloon-preferences"] as const;
export type PreferencePullDomain = typeof PREFERENCE_PULL_DOMAINS[number];
type PullDomain = typeof FAVORITE_WEATHER_PLACE_PULL_DOMAIN | typeof FAVORITE_LAUNCH_SITE_PULL_DOMAIN | PreferencePullDomain | "pilot-profile" | "balloon" | "flight" | "logbook-entry" | "balloon-document";

export type CloudPullRow = Readonly<{ id: string; entityId: string; userId: string; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; value?: unknown }>;
export type FavoriteWeatherPlaceCloudRow = Readonly<{ id: string; userId: string; syncId: string | null; name: string; latitude: number; longitude: number; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }>;
export type FavoriteLaunchSiteCloudRow = Readonly<{ id: string; entityId: string; userId: string; syncId: string | null; name: string; sourceName: string | null; latitude: number; longitude: number; icaoCode: string | null; altitudeAmslM: number | null; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null }>;
export type PreferenceCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type PilotProfileCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type BalloonCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type FlightCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type LogbookEntryCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type DocumentCloudRow = CloudPullRow & Readonly<{ value: unknown }>;
export type FavoriteWeatherPlacePullConflict = Readonly<{ entityId: string; reason: "REMOTE_ADVANCED" | "REMOTE_TOMBSTONE" | "LOCAL_CREATION_COLLISION"; cloudRevision: number; mutationId: string }>;
export type FavoriteWeatherPlacePullAnomaly = Readonly<{ entityId: string; reason: "REMOTE_REVISION_BEHIND_LOCAL" | "LOCAL_BASE_REVISION_AHEAD" | "LOCAL_DEPENDENCY" | "LOCAL_UNIQUENESS_CONFLICT" | "LOCAL_BLOB_PRESENT"; cloudRevision: number; localRevision: number }>;
export type CloudPullFailure = Readonly<{ step: "READ_PAGE" | "PARSE_ROW" | "APPLY_LOCAL" | "WRITE_SIDECAR" | "WRITE_CURSOR" | "UNKNOWN"; code: string; message: string }>;
export type FavoriteWeatherPlacePullReport = Readonly<{ state: "COMPLETED" | "REFUSED_GUEST" | "REFUSED_NO_SESSION" | "STOPPED_USER_SWITCH" | "STOPPED_ERROR" | "BLOCKED_ANOMALY"; fetched: number; applied: number; tombstonesApplied: number; preservedLocalPending: number; conflicts: readonly FavoriteWeatherPlacePullConflict[]; anomalies: readonly FavoriteWeatherPlacePullAnomaly[]; pages: number; cursor: CloudPullCursor | null; error?: CloudPullFailure }>;

export class CloudPullTechnicalError extends Error {
  readonly step: CloudPullFailure["step"];
  readonly code: string;
  constructor(step: CloudPullFailure["step"], code: string, message: string) {
    super(message);
    this.name = "CloudPullTechnicalError";
    this.step = step;
    this.code = code;
  }
}

type PullDomainAdapter<Row extends CloudPullRow> = Readonly<{ readPage(cursor: CloudPullCursor | null, limit: number): Promise<readonly Row[]>; applyLocally(row: Row): Promise<boolean> | boolean; hasBlockingLocalDependency?(row: Row): Promise<boolean> | boolean; localAnomaly?(row: Row): Promise<FavoriteWeatherPlacePullAnomaly["reason"] | null> | FavoriteWeatherPlacePullAnomaly["reason"] | null }>;
export type FavoriteWeatherPlacePullDependencies = Readonly<{
  scope: LocalDataScope | null;
  getScope(): LocalDataScope | null;
  getOnlineUserId(): Promise<string | null>;
  outbox: Pick<SyncOutboxStorage, "list" | "getMetadata" | "setMetadata">;
  cursors: CloudPullCursorRepository;
  readPage(cursor: CloudPullCursor | null, limit: number): Promise<readonly FavoriteWeatherPlaceCloudRow[]>;
  applyLocally(row: FavoriteWeatherPlaceCloudRow): Promise<boolean> | boolean;
  favoriteLaunchSiteDomain?: PullDomainAdapter<FavoriteLaunchSiteCloudRow>;
  profileDomain?: PullDomainAdapter<PilotProfileCloudRow>;
  preferenceDomains?: Partial<Record<PreferencePullDomain, PullDomainAdapter<PreferenceCloudRow>>>;
  balloonDomain?: PullDomainAdapter<BalloonCloudRow>;
  flightDomain?: PullDomainAdapter<FlightCloudRow>;
  logbookEntryDomain?: PullDomainAdapter<LogbookEntryCloudRow>;
  documentDomain?: PullDomainAdapter<DocumentCloudRow>;
  recordConflict(conflict: FavoriteWeatherPlacePullConflict, mutation: SyncMutation, row: CloudPullRow): Promise<void>;
}>;

function userIdFromScope(scope: LocalDataScope | null): string | null { return scope?.startsWith("USER:") ? scope.slice(5) : null; }
function emptyReport(state: FavoriteWeatherPlacePullReport["state"], cursor: CloudPullCursor | null = null): FavoriteWeatherPlacePullReport { return { state, fetched: 0, applied: 0, tombstonesApplied: 0, preservedLocalPending: 0, conflicts: [], anomalies: [], pages: 0, cursor }; }

function pullFailure(error: unknown, fallbackStep: CloudPullFailure["step"]): CloudPullFailure {
  const technical = error instanceof CloudPullTechnicalError ? error : null;
  const rawMessage = error instanceof Error ? error.message : "Unknown cloud pull error";
  return {
    step: technical?.step ?? fallbackStep,
    code: technical?.code ?? "UNEXPECTED_ERROR",
    message: rawMessage.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 300),
  };
}

export class CloudPullService {
  private readonly dependencies: FavoriteWeatherPlacePullDependencies;
  constructor(dependencies: FavoriteWeatherPlacePullDependencies) { this.dependencies = dependencies; }

  pullFavoriteWeatherPlaces(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> {
    return this.pullDomain(FAVORITE_WEATHER_PLACE_PULL_DOMAIN, {
      readPage: async (cursor, limit) => (await this.dependencies.readPage(cursor, limit)).map((row) => ({ ...row, entityId: row.id })),
      applyLocally: (row) => this.dependencies.applyLocally(row),
    }, pageSize);
  }
  pullFavoriteLaunchSites(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.favoriteLaunchSiteDomain ? this.pullDomain(FAVORITE_LAUNCH_SITE_PULL_DOMAIN, this.dependencies.favoriteLaunchSiteDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }
  pullPilotProfile(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.profileDomain ? this.pullDomain("pilot-profile", this.dependencies.profileDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }
  pullUnitPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("unit-preferences", pageSize); }
  pullWeatherPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("weather-preferences", pageSize); }
  pullAviationPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("aviation-preferences", pageSize); }
  pullPilotQualifications(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("pilot-qualifications", pageSize); }
  pullBalloonPreferences(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.pullPreferenceDomain("balloon-preferences", pageSize); }
  pullBalloons(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.balloonDomain ? this.pullDomain("balloon", this.dependencies.balloonDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }
  pullFlights(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.flightDomain ? this.pullDomain("flight", this.dependencies.flightDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }
  pullLogbookEntries(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.logbookEntryDomain ? this.pullDomain("logbook-entry", this.dependencies.logbookEntryDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }
  pullDocuments(pageSize = 25): Promise<FavoriteWeatherPlacePullReport> { return this.dependencies.documentDomain ? this.pullDomain("balloon-document", this.dependencies.documentDomain, pageSize) : Promise.resolve(emptyReport("STOPPED_ERROR")); }

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
    let currentStep: CloudPullFailure["step"] = "READ_PAGE";
    const conflicts: FavoriteWeatherPlacePullConflict[] = [], anomalies: FavoriteWeatherPlacePullAnomaly[] = [];
    try {
      while (true) {
        if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
        currentStep = "READ_PAGE";
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
            const localAnomaly = await adapter.localAnomaly?.(row);
            if (localAnomaly) {
              anomalies.push({ entityId: row.entityId, reason: localAnomaly, cloudRevision: row.revision, localRevision: sidecar?.revision ?? 0 });
              return { state: "BLOCKED_ANOMALY", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            }
            if (await adapter.hasBlockingLocalDependency?.(row)) {
              anomalies.push({ entityId: row.entityId, reason: "LOCAL_DEPENDENCY", cloudRevision: row.revision, localRevision: sidecar?.revision ?? 0 });
              return { state: "BLOCKED_ANOMALY", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            }
            if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            currentStep = "APPLY_LOCAL";
            if (!await adapter.applyLocally(row)) throw new Error("Cloud row could not be applied locally");
            if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
            currentStep = "WRITE_SIDECAR";
            await this.dependencies.outbox.setMetadata({ entityType: domain, entityId: row.entityId, revision: row.revision, updatedAt: row.updatedAt, ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}) });
            applied += 1;
            if (row.deletedAt) tombstonesApplied += 1;
          }
          if (!await this.onlineUserIs(expectedUserId)) return { state: "STOPPED_USER_SWITCH", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
          const nextCursor = { updatedAt: row.updatedAt, id: row.id };
          currentStep = "WRITE_CURSOR";
          await this.dependencies.cursors.set(userScope, domain, nextCursor);
          cursor = nextCursor;
        }
        if (rows.length < pageSize) break;
      }
      return { state: "COMPLETED", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor };
    } catch (error) { return { state: "STOPPED_ERROR", fetched, applied, tombstonesApplied, preservedLocalPending, conflicts, anomalies, pages, cursor, error: pullFailure(error, currentStep) }; }
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
