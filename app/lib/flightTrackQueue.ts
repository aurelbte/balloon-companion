import type { LocalDataScope } from "./auth/dataScope.ts";
import { getRuntimeDataScope, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";

export const FLIGHT_TRACK_QUEUE_DB_NAME = "balloon-companion-flight-track-queue-v1";
export const FLIGHT_TRACK_QUEUE_STORE = "jobs";
export const FLIGHT_TRACK_QUEUE_CHANGED_EVENT = "balloon-companion:flight-track-queue-changed";
export type FlightTrackOperation = "UPLOAD" | "DOWNLOAD" | "DELETE";
export type FlightTrackJob = Readonly<{
  jobId: string;
  scope: `USER:${string}`;
  userId: string;
  flightId: string;
  operation: FlightTrackOperation;
  objectKey?: string;
  generation: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextEligibleRetryAt?: string;
  lastErrorCode?: string;
  lastErrorCategory?: "NETWORK" | "SERVER" | "AUTH" | "INTEGRITY" | "LOCAL";
  status: "PENDING" | "FAILED";
}>;

export interface FlightTrackQueueStorage {
  list(): Promise<FlightTrackJob[]>;
  put(job: FlightTrackJob): Promise<void>;
  remove(jobId: string): Promise<void>;
  removeMany(jobIds: readonly string[]): Promise<void>;
}

function createJobId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("TRACK_JOB_ID_UNAVAILABLE");
}

export function flightTrackBackoffMs(attempts: number): number {
  return [5_000, 15_000, 45_000, 120_000, 300_000, 900_000][Math.min(Math.max(attempts - 1, 0), 5)]!;
}

export class MemoryFlightTrackQueueStorage implements FlightTrackQueueStorage {
  private readonly jobs: Map<string, FlightTrackJob>;
  constructor(jobs = new Map<string, FlightTrackJob>()) { this.jobs = jobs; }
  async list() { return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async put(job: FlightTrackJob) { this.jobs.set(job.jobId, structuredClone(job)); }
  async remove(jobId: string) { this.jobs.delete(jobId); }
  async removeMany(jobIds: readonly string[]) { for (const id of jobIds) this.jobs.delete(id); }
}

export class IndexedDbFlightTrackQueueStorage implements FlightTrackQueueStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly scope: `USER:${string}`;
  constructor(scope: `USER:${string}`) { this.scope = scope; }
  private database(): Promise<IDBDatabase> {
    if (getRuntimeDataScope() !== this.scope) return Promise.reject(new Error("TRACK_QUEUE_SCOPE_MISMATCH"));
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(scopedIndexedDbName(this.scope, FLIGHT_TRACK_QUEUE_DB_NAME), 1);
      request.onupgradeneeded = () => request.result.createObjectStore(FLIGHT_TRACK_QUEUE_STORE, { keyPath: "jobId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }
  async list(): Promise<FlightTrackJob[]> {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(FLIGHT_TRACK_QUEUE_STORE).objectStore(FLIGHT_TRACK_QUEUE_STORE).getAll();
      request.onsuccess = () => resolve((request.result as FlightTrackJob[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      request.onerror = () => reject(request.error);
    });
  }
  async put(job: FlightTrackJob): Promise<void> { await this.write((store) => store.put(job)); }
  async remove(jobId: string): Promise<void> { await this.write((store) => store.delete(jobId)); }
  async removeMany(jobIds: readonly string[]): Promise<void> { await this.write((store) => { for (const id of jobIds) store.delete(id); }); }
  private async write(action: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(FLIGHT_TRACK_QUEUE_STORE, "readwrite");
      action(transaction.objectStore(FLIGHT_TRACK_QUEUE_STORE));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

export async function enqueueFlightTrackJob(
  storage: FlightTrackQueueStorage,
  input: Readonly<{ scope: `USER:${string}`; flightId: string; operation: FlightTrackOperation; generation?: number; objectKey?: string }>,
  now = new Date().toISOString(),
): Promise<FlightTrackJob> {
  if (getRuntimeDataScope() !== input.scope) throw new Error("TRACK_QUEUE_SCOPE_MISMATCH");
  const jobs = await storage.list();
  const related = jobs.filter((job) => job.flightId === input.flightId);
  const exact = related.find((job) => job.operation === input.operation && job.generation === (input.generation ?? 1));
  if (exact) return exact;
  if (input.operation === "DELETE") await storage.removeMany(related.map(({ jobId }) => jobId));
  else if (related.some((job) => job.operation === "DELETE")) throw new Error("TRACK_DELETE_ALREADY_PENDING");
  else await storage.removeMany(related.filter((job) => job.operation !== input.operation).map(({ jobId }) => jobId));
  const job: FlightTrackJob = {
    jobId: createJobId(), scope: input.scope, userId: input.scope.slice(5), flightId: input.flightId,
    operation: input.operation, generation: input.generation ?? 1, attempts: 0, createdAt: now, updatedAt: now,
    ...(input.objectKey ? { objectKey: input.objectKey } : {}), status: "PENDING",
  };
  await storage.put(job);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLIGHT_TRACK_QUEUE_CHANGED_EVENT));
  return job;
}

export type FlightTrackQueueTransport = Readonly<{
  upload(flightId: string): Promise<unknown>;
  download(flightId: string): Promise<unknown>;
  cleanup(flightId: string): Promise<unknown>;
}>;

export type FlightTrackQueueDrainResult = Readonly<{ processed: number; succeeded: number; failed: number; stoppedForUserSwitch: boolean }>;
const activeDrains = new Map<string, Promise<FlightTrackQueueDrainResult>>();
export function isFlightTrackQueueRunning(scope: `USER:${string}`): boolean { return activeDrains.has(scope); }

function errorDetails(error: unknown): Pick<FlightTrackJob, "lastErrorCode" | "lastErrorCategory"> {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  const code = message.split(":", 1)[0]!.slice(0, 80);
  const category = /AUTH|JWT|401|403|USER_SWITCH|SCOPE/.test(message) ? "AUTH" : /CHECKSUM|SIZE|SCHEMA|MISMATCH|INVALID/.test(message) ? "INTEGRITY" : /LOCAL/.test(message) ? "LOCAL" : /5\d\d|SERVER|METADATA/.test(message) ? "SERVER" : "NETWORK";
  return { lastErrorCode: code, lastErrorCategory: category };
}

export function drainFlightTrackQueue(input: Readonly<{
  scope: `USER:${string}`;
  storage: FlightTrackQueueStorage;
  transport: FlightTrackQueueTransport;
  getScope?: () => LocalDataScope | null;
  online?: () => boolean;
  now?: () => Date;
}>): Promise<FlightTrackQueueDrainResult> {
  const running = activeDrains.get(input.scope);
  if (running) return running;
  const promise = (async () => {
    const result = { processed: 0, succeeded: 0, failed: 0, stoppedForUserSwitch: false };
    const getScope = input.getScope ?? getRuntimeDataScope;
    const now = input.now ?? (() => new Date());
    if (getScope() !== input.scope || !(input.online ?? (() => navigator.onLine))()) return { ...result, stoppedForUserSwitch: getScope() !== input.scope };
    for (const job of await input.storage.list()) {
      if (job.scope !== input.scope || job.userId !== input.scope.slice(5)) continue;
      if (job.nextEligibleRetryAt && Date.parse(job.nextEligibleRetryAt) > now().getTime()) continue;
      if (getScope() !== input.scope) return { ...result, stoppedForUserSwitch: true };
      result.processed += 1;
      try {
        if (job.operation === "UPLOAD") await input.transport.upload(job.flightId);
        else if (job.operation === "DOWNLOAD") await input.transport.download(job.flightId);
        else await input.transport.cleanup(job.flightId);
        if (getScope() !== input.scope) return { ...result, stoppedForUserSwitch: true };
        await input.storage.remove(job.jobId);
        result.succeeded += 1;
      } catch (error) {
        if (getScope() !== input.scope) return { ...result, stoppedForUserSwitch: true };
        const attempts = job.attempts + 1;
        const timestamp = now();
        await input.storage.put({ ...job, attempts, updatedAt: timestamp.toISOString(), nextEligibleRetryAt: new Date(timestamp.getTime() + flightTrackBackoffMs(attempts)).toISOString(), ...errorDetails(error), status: "FAILED" });
        result.failed += 1;
      }
    }
    return result;
  })().finally(() => activeDrains.delete(input.scope));
  activeDrains.set(input.scope, promise);
  return promise;
}

export async function nextFlightTrackRetryAt(storage: FlightTrackQueueStorage): Promise<string | null> {
  const dates = (await storage.list()).flatMap(({ nextEligibleRetryAt }) => nextEligibleRetryAt ? [Date.parse(nextEligibleRetryAt)] : [0]).filter(Number.isFinite);
  return dates.length ? new Date(Math.min(...dates)).toISOString() : null;
}
