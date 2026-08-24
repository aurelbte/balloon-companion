export type AutomaticBootstrapResult = Readonly<{
  state: "SUCCESS" | "PARTIAL" | "BLOCKED" | "OFFLINE" | "SESSION_INVALID";
  resumable: boolean;
}>;

type Dependencies = Readonly<{
  isOnline(): boolean;
  bootstrap(userId: string): Promise<AutomaticBootstrapResult>;
  push(userId: string): Promise<unknown>;
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

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
  }

  setUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.userId = userId;
    this.generation += 1;
    this.bootstrapRequested = userId !== null;
    this.pushRequested = userId !== null;
    this.schedule();
  }

  notifyOnline(): void {
    if (!this.userId || !this.dependencies.isOnline()) return;
    this.bootstrapRequested = true;
    this.schedule();
  }

  notifyLocalMutation(): void {
    if (!this.userId) return;
    this.pushRequested = true;
    this.schedule();
  }

  resumeBootstrap(): void {
    if (!this.userId) return;
    this.bootstrapRequested = true;
    this.schedule();
  }

  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private schedule(): void {
    if (this.running || !this.userId || !this.dependencies.isOnline()) return;
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.userId && this.dependencies.isOnline() && this.bootstrapRequested) this.schedule();
    });
  }

  private async run(): Promise<void> {
    const userId = this.userId;
    const generation = this.generation;
    if (!userId) return;
    let bootstrapSucceeded = false;
    if (this.bootstrapRequested) {
      this.bootstrapRequested = false;
      const report = await this.dependencies.bootstrap(userId);
      if (generation !== this.generation || userId !== this.userId) return;
      bootstrapSucceeded = report.state === "SUCCESS";
    }
    if (bootstrapSucceeded && this.pushRequested && generation === this.generation && userId === this.userId) {
      this.pushRequested = false;
      await this.dependencies.push(userId);
    }
  }
}
