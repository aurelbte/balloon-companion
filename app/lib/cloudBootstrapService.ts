import type { LocalDataScope } from "./auth/dataScope.ts";
import type { FavoriteWeatherPlacePullReport } from "./cloudPullService.ts";
import type { SyncMutation } from "./syncOutbox.ts";

export const CLOUD_BOOTSTRAP_DOMAIN_ORDER = [
  "profile",
  "unitPreferences",
  "weatherPreferences",
  "aviationPreferences",
  "favoriteWeatherPlaces",
  "favoriteLaunchSites",
  "balloons",
  "flights",
  "logbookEntries",
  "documents",
] as const;

export type CloudBootstrapDomain = typeof CLOUD_BOOTSTRAP_DOMAIN_ORDER[number];
export type CloudBootstrapState = "SUCCESS" | "PARTIAL" | "BLOCKED" | "OFFLINE" | "SESSION_INVALID";
export type CloudBootstrapReport = Readonly<{
  state: CloudBootstrapState;
  startedAt: string;
  completedAt: string;
  userId: string | null;
  domains: Partial<Record<CloudBootstrapDomain, FavoriteWeatherPlacePullReport>>;
  totals: Readonly<{ fetched: number; applied: number; tombstonesApplied: number; preservedLocalPending: number; conflicts: number; anomalies: number }>;
  stoppedAtDomain: CloudBootstrapDomain | null;
  resumable: boolean;
  outboxPreserved: boolean;
}>;

type CloudBootstrapDependencies = Readonly<{
  scope: LocalDataScope | null;
  getScope(): LocalDataScope | null;
  getOnlineUserId(): Promise<string | null>;
  isOnline(): boolean;
  listOutbox(): Promise<readonly SyncMutation[]>;
  pulls: Readonly<Record<CloudBootstrapDomain, () => Promise<FavoriteWeatherPlacePullReport>>>;
  now(): string;
}>;

function userIdFromScope(scope: LocalDataScope | null): string | null {
  return scope?.startsWith("USER:") ? scope.slice(5) : null;
}

function sameOutbox(before: readonly SyncMutation[], after: readonly SyncMutation[]): boolean {
  const normalized = (mutations: readonly SyncMutation[]) => [...mutations]
    .sort((left, right) => left.mutationId.localeCompare(right.mutationId))
    .map((mutation) => JSON.stringify(mutation));
  return JSON.stringify(normalized(before)) === JSON.stringify(normalized(after));
}

export class CloudBootstrapService {
  private readonly dependencies: CloudBootstrapDependencies;
  constructor(dependencies: CloudBootstrapDependencies) { this.dependencies = dependencies; }

  async bootstrapCloudDataForCurrentUser(): Promise<CloudBootstrapReport> {
    const startedAt = this.dependencies.now();
    const expectedUserId = userIdFromScope(this.dependencies.scope);
    const domains: CloudBootstrapReport["domains"] = {};
    const totals = { fetched: 0, applied: 0, tombstonesApplied: 0, preservedLocalPending: 0, conflicts: 0, anomalies: 0 };
    let before: readonly SyncMutation[] = [];
    let state: CloudBootstrapState = "SUCCESS";
    let stoppedAtDomain: CloudBootstrapDomain | null = null;
    if (!expectedUserId || this.dependencies.getScope() !== this.dependencies.scope) state = "SESSION_INVALID";
    else {
      try {
        before = await this.dependencies.listOutbox();
        if (!this.dependencies.isOnline()) state = "OFFLINE";
        else if (await this.dependencies.getOnlineUserId() !== expectedUserId) state = "SESSION_INVALID";
      } catch { state = this.dependencies.isOnline() ? "SESSION_INVALID" : "OFFLINE"; }
    }
    if (state === "SUCCESS") {
      for (const domain of CLOUD_BOOTSTRAP_DOMAIN_ORDER) {
        if (!this.dependencies.isOnline()) { state = "OFFLINE"; stoppedAtDomain = domain; break; }
        if (this.dependencies.getScope() !== this.dependencies.scope || await this.safeOnlineUserId() !== expectedUserId) {
          state = "SESSION_INVALID"; stoppedAtDomain = domain; break;
        }
        let report: FavoriteWeatherPlacePullReport;
        try { report = await this.dependencies.pulls[domain](); }
        catch { state = this.dependencies.isOnline() ? "PARTIAL" : "OFFLINE"; stoppedAtDomain = domain; break; }
        domains[domain] = report;
        totals.fetched += report.fetched;
        totals.applied += report.applied;
        totals.tombstonesApplied += report.tombstonesApplied;
        totals.preservedLocalPending += report.preservedLocalPending;
        totals.conflicts += report.conflicts.length;
        totals.anomalies += report.anomalies.length;
        if (report.state === "BLOCKED_ANOMALY") { state = "BLOCKED"; stoppedAtDomain = domain; break; }
        if (report.state === "STOPPED_USER_SWITCH" || report.state === "REFUSED_NO_SESSION" || report.state === "REFUSED_GUEST") {
          state = "SESSION_INVALID"; stoppedAtDomain = domain; break;
        }
        if (report.state === "STOPPED_ERROR") {
          state = this.dependencies.isOnline() ? "PARTIAL" : "OFFLINE"; stoppedAtDomain = domain; break;
        }
        if (report.conflicts.length > 0 || report.preservedLocalPending > 0) state = "PARTIAL";
      }
    }
    if (state === "SUCCESS" && (totals.conflicts > 0 || totals.preservedLocalPending > 0)) state = "PARTIAL";
    if ((state === "SUCCESS" || state === "PARTIAL")
      && (this.dependencies.getScope() !== this.dependencies.scope || await this.safeOnlineUserId() !== expectedUserId)) state = "SESSION_INVALID";
    const after = expectedUserId ? await this.dependencies.listOutbox().catch(() => before) : before;
    const outboxPreserved = sameOutbox(before, after);
    if (!outboxPreserved && state !== "OFFLINE" && state !== "SESSION_INVALID") state = "BLOCKED";
    return {
      state,
      startedAt,
      completedAt: this.dependencies.now(),
      userId: expectedUserId,
      domains,
      totals,
      stoppedAtDomain,
      resumable: state !== "SUCCESS",
      outboxPreserved,
    };
  }

  private async safeOnlineUserId(): Promise<string | null> {
    try { return await this.dependencies.getOnlineUserId(); } catch { return null; }
  }
}
