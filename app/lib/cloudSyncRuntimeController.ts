export type AutomaticBootstrapResult = Readonly<{
  state: "SUCCESS" | "PARTIAL" | "BLOCKED" | "STOPPED_ERROR" | "OFFLINE" | "SESSION_INVALID";
  resumable: boolean;
  stoppedAtDomain?: string | null;
  domains?: unknown;
}>;

export type CloudSyncRuntimeTrigger = "USER_SESSION" | "ONLINE" | "LOCAL_MUTATION" | "RESUME";
export type CloudSyncRuntimeDiagnosticEvent = Readonly<{ at: string; type: string; userId: string | null; result?: string }>;
export type CloudSyncRuntimeControllerSnapshot = Readonly<{
  scope: `USER:${string}` | null;
  userId: string | null;
  online: boolean;
  active: boolean;
  bootstrapInProgress: boolean;
  pushInProgress: boolean;
  lastTrigger: CloudSyncRuntimeTrigger | null;
  lastBootstrapState: AutomaticBootstrapResult["state"] | null;
  lastStoppedAtDomain: string | null;
  lastError: Readonly<{ code: string; message: string }> | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastPushAuthorized: boolean | null;
  lastPushExecuted: boolean;
  lastPushRefusalReason: string | null;
  deduplicatedRequests: number;
  cancelledExecutions: number;
  history: readonly CloudSyncRuntimeDiagnosticEvent[];
}>;

type Dependencies = Readonly<{
  isOnline(): boolean;
  bootstrap(userId: string): Promise<AutomaticBootstrapResult>;
  push(userId: string): Promise<unknown>;
  now?(): string;
  onDiagnosticChange?(snapshot: CloudSyncRuntimeControllerSnapshot): void;
}>;

/**
 * Serializes the future automatic PULL/PUSH wiring. It deliberately allows a
 * PUSH only after a successful bootstrap; PARTIAL needs a fresh explicit
 * trigger so a conflict is never drained merely because a PULL completed.
 */
export class CloudSyncRuntimeController {
  private readonly dependencies: Dependencies;
  private userId: string | null = null;
  private generation = 0;
  private bootstrapRequested = false;
  private pushRequested = false;
  private running: Promise<void> | null = null;
  private readyGeneration = -1;
  private bootstrapInProgress = false;
  private pushInProgress = false;
  private lastTrigger: CloudSyncRuntimeTrigger | null = null;
  private lastBootstrapState: AutomaticBootstrapResult["state"] | null = null;
  private lastStoppedAtDomain: string | null = null;
  private lastError: Readonly<{ code: string; message: string }> | null = null;
  private lastStartedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastPushAuthorized: boolean | null = null;
  private lastPushExecuted = false;
  private lastPushRefusalReason: string | null = null;
  private deduplicatedRequests = 0;
  private cancelledExecutions = 0;
  private history: CloudSyncRuntimeDiagnosticEvent[] = [];

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  setUser(userId: string | null): void {
    if (userId === this.userId) { this.deduplicatedRequests += 1; this.publish(); return; }
    const previous = this.userId;
    this.userId = userId;
    this.generation += 1;
    if (this.running && previous) this.cancelledExecutions += 1;
    this.readyGeneration = -1;
    this.bootstrapRequested = userId !== null;
    this.pushRequested = userId !== null;
    this.lastTrigger = userId ? "USER_SESSION" : null;
    this.record(userId ? (previous ? "USER_SWITCH" : "TRIGGER_USER") : "LOGOUT", userId);
    this.schedule();
  }

  notifyOnline(): void {
    if (!this.userId || !this.dependencies.isOnline()) return;
    if (this.bootstrapInProgress) { this.deduplicatedRequests += 1; this.publish(); return; }
    this.readyGeneration = -1;
    this.bootstrapRequested = true;
    this.lastTrigger = "ONLINE";
    this.record("TRIGGER_ONLINE", this.userId);
    this.schedule();
  }

  notifyLocalMutation(): void {
    if (!this.userId) return;
    if (this.pushRequested) this.deduplicatedRequests += 1;
    this.pushRequested = true;
    this.lastTrigger = "LOCAL_MUTATION";
    this.record("TRIGGER_LOCAL_MUTATION", this.userId);
    this.schedule();
  }

  resumeBootstrap(): void {
    if (!this.userId) return;
    if (this.bootstrapRequested || this.bootstrapInProgress) { this.deduplicatedRequests += 1; this.publish(); return; }
    this.bootstrapRequested = true;
    this.lastTrigger = "RESUME";
    this.record("TRIGGER_RESUME", this.userId);
    this.schedule();
  }

  inspect(): CloudSyncRuntimeControllerSnapshot {
    return {
      scope: this.userId ? `USER:${this.userId}` : null,
      userId: this.userId,
      online: this.dependencies.isOnline(),
      active: this.userId !== null,
      bootstrapInProgress: this.bootstrapInProgress,
      pushInProgress: this.pushInProgress,
      lastTrigger: this.lastTrigger,
      lastBootstrapState: this.lastBootstrapState,
      lastStoppedAtDomain: this.lastStoppedAtDomain,
      lastError: this.lastError ? { ...this.lastError } : null,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastPushAuthorized: this.lastPushAuthorized,
      lastPushExecuted: this.lastPushExecuted,
      lastPushRefusalReason: this.lastPushRefusalReason,
      deduplicatedRequests: this.deduplicatedRequests,
      cancelledExecutions: this.cancelledExecutions,
      history: this.history.map((event) => ({ ...event })),
    };
  }

  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private schedule(): void {
    if (this.running || !this.userId || !this.dependencies.isOnline()) return;
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.userId && this.dependencies.isOnline()
        && (this.bootstrapRequested || this.pushRequested && this.readyGeneration === this.generation)) this.schedule();
    });
  }

  private async run(): Promise<void> {
    const userId = this.userId;
    const generation = this.generation;
    if (!userId) return;
    let bootstrapSucceeded = false;
    if (this.bootstrapRequested) {
      this.bootstrapRequested = false;
      this.bootstrapInProgress = true;
      this.lastStartedAt = this.now();
      this.lastPushExecuted = false;
      this.record("BOOTSTRAP_STARTED", userId);
      let report: AutomaticBootstrapResult;
      try { report = await this.dependencies.bootstrap(userId); }
      catch (error) {
        this.lastBootstrapState = "STOPPED_ERROR";
        this.lastError = this.safeError(error);
        this.lastPushAuthorized = false;
        this.lastPushRefusalReason = "BOOTSTRAP_STOPPED_ERROR";
        this.lastCompletedAt = this.now();
        this.record("BOOTSTRAP_ERROR", userId, "STOPPED_ERROR");
        return;
      } finally { this.bootstrapInProgress = false; this.publish(); }
      if (generation !== this.generation || userId !== this.userId) { this.record("BOOTSTRAP_CANCELLED", userId); return; }
      bootstrapSucceeded = report.state === "SUCCESS";
      this.readyGeneration = bootstrapSucceeded ? generation : -1;
      this.lastBootstrapState = report.state;
      this.lastStoppedAtDomain = report.stoppedAtDomain ?? null;
      const stoppedDomainReport = this.lastStoppedAtDomain && report.domains && typeof report.domains === "object"
        ? (report.domains as Record<string, unknown>)[this.lastStoppedAtDomain] : undefined;
      const candidateError = stoppedDomainReport && typeof stoppedDomainReport === "object"
        ? (stoppedDomainReport as { error?: unknown }).error : undefined;
      const domainError = candidateError && typeof candidateError === "object"
        && typeof (candidateError as { code?: unknown }).code === "string"
        && typeof (candidateError as { message?: unknown }).message === "string"
        ? candidateError as { code: string; message: string } : undefined;
      this.lastError = domainError ? { code: domainError.code, message: this.sanitize(domainError.message) } : null;
      this.lastPushAuthorized = bootstrapSucceeded;
      this.lastPushRefusalReason = bootstrapSucceeded ? null : `BOOTSTRAP_${report.state}`;
      this.lastCompletedAt = this.now();
      this.record(`BOOTSTRAP_${report.state}`, userId, report.state);
    }
    if ((bootstrapSucceeded || this.readyGeneration === generation) && this.pushRequested && this.dependencies.isOnline()
      && generation === this.generation && userId === this.userId) {
      this.pushRequested = false;
      this.pushInProgress = true;
      this.record("PUSH_STARTED", userId);
      try { await this.dependencies.push(userId); this.lastPushExecuted = true; this.record("PUSH_COMPLETED", userId); }
      catch { /* A later enqueue/online event can safely retry the preserved outbox. */ }
      finally { this.pushInProgress = false; this.publish(); }
    } else if (this.pushRequested && !bootstrapSucceeded && this.readyGeneration !== generation) {
      this.record("PUSH_SKIPPED", userId, this.lastPushRefusalReason ?? "BOOTSTRAP_NOT_READY");
    }
  }

  private now(): string { return this.dependencies.now?.() ?? new Date().toISOString(); }
  private sanitize(message: string): string { return message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 300); }
  private safeError(error: unknown): Readonly<{ code: string; message: string }> {
    return { code: "UNEXPECTED_ERROR", message: this.sanitize(error instanceof Error ? error.message : "Unknown runtime error") };
  }
  private record(type: string, userId: string | null, result?: string): void {
    this.history.push({ at: this.now(), type, userId, ...(result ? { result } : {}) });
    this.history = this.history.slice(-10);
    this.publish();
  }
  private publish(): void { this.dependencies.onDiagnosticChange?.(this.inspect()); }
}
