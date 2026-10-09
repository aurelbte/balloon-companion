/** Temporary production diagnostic. No transport, persistence, discovery or repair dependencies. */
import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CloudSyncRuntimeControllerSnapshot } from "./cloudSyncRuntimeController.ts";

type Row = Record<string, unknown>;
type ReadResult = { state: "READ" | "ABSENT" | "UNAVAILABLE"; rows: Row[] };

/** Never create/upgrade a database, including if it is deleted between enumeration and open. */
export async function readExistingDebugStore(factory: IDBFactory, name: string, store: string): Promise<ReadResult> {
  try {
    if (typeof factory.databases !== "function") return { state: "UNAVAILABLE", rows: [] };
    if (!(await factory.databases()).some(database => database.name === name)) return { state: "ABSENT", rows: [] };
    return await new Promise<ReadResult>((resolve) => {
      const request = factory.open(name);
      let settled = false;
      let database: IDBDatabase | undefined;
      const finish = (result: ReadResult) => {
        settled = true;
        clearTimeout(timer);
        database?.close();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ state: "UNAVAILABLE", rows: [] }), 3000);
      request.onupgradeneeded = () => { request.transaction?.abort(); };
      request.onerror = () => finish({ state: "UNAVAILABLE", rows: [] });
      request.onblocked = () => finish({ state: "UNAVAILABLE", rows: [] });
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        if (!database.objectStoreNames.contains(store)) { finish({ state: "ABSENT", rows: [] }); return; }
        try {
          const transaction = database.transaction(store, "readonly");
          const read = transaction.objectStore(store).getAll();
          transaction.oncomplete = () => finish({ state: "READ", rows: read.result as Row[] });
          transaction.onerror = transaction.onabort = () => finish({ state: "UNAVAILABLE", rows: [] });
        } catch { finish({ state: "UNAVAILABLE", rows: [] }); }
      };
    });
  } catch { return { state: "UNAVAILABLE", rows: [] }; }
}

const code = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const abbreviation = (id: string) => `${id.slice(0, Math.min(8, Math.floor(id.length / 2)))}…`;

type Discovery = { known: boolean; complete: boolean; generation: number | null; downloadsChecked: boolean; discoveryError: string | null; active: boolean };
export type FlightTrackDebugInput = {
  getScope(): LocalDataScope | null;
  getGeneration(): number;
  databaseName(scope: LocalDataScope, name: string): string;
  getRuntime(): CloudSyncRuntimeControllerSnapshot;
  getDiscovery(): Discovery;
  getGate(): { controlledMode: boolean; localDataReady: boolean; localCollisionCount: number };
  factory?: IDBFactory;
};

export async function getFlightTrackDebugSnapshot(input: FlightTrackDebugInput) {
  const scope = input.getScope(), generation = input.getGeneration();
  const unavailable = (reason: string) => ({ state: reason, flights: [] });
  if (!scope) return unavailable("NO_LOCAL_SCOPE");
  const runtime = input.getRuntime(), discovery = input.getDiscovery(), gate = input.getGate();
  if (!input.factory) return unavailable("INDEXEDDB_UNAVAILABLE");
  const [flights, jobs] = await Promise.all([
    readExistingDebugStore(input.factory, input.databaseName(scope, "balloon-companion-flights"), "flights"),
    scope.startsWith("USER:")
      ? readExistingDebugStore(input.factory, input.databaseName(scope, "balloon-companion-flight-track-queue-v1"), "jobs")
      : Promise.resolve<ReadResult>({ state: "ABSENT", rows: [] }),
  ]);
  if (scope !== input.getScope() || generation !== input.getGeneration()) return unavailable("SCOPE_CHANGED");
  const sameRuntimeScope = runtime.scope === scope;
  return {
    state: flights.state === "READ" && (jobs.state === "READ" || jobs.state === "ABSENT") ? "READ" : "PARTIAL",
    scope: scope === "GUEST" ? "GUEST" : "USER",
    localReadState: flights.state,
    queueReadState: jobs.state,
    runtime: {
      scopeMatches: sameRuntimeScope,
      online: runtime.online,
      active: sameRuntimeScope && runtime.active,
      controlledMode: gate.controlledMode,
      localDataReady: gate.localDataReady,
      localCollisionCount: gate.localCollisionCount,
      bootstrapInProgress: sameRuntimeScope && runtime.bootstrapInProgress,
      pushInProgress: sameRuntimeScope && runtime.pushInProgress,
      lastBootstrapState: sameRuntimeScope ? code(runtime.lastBootstrapState) : null,
      lastPushState: sameRuntimeScope ? code(runtime.lastPushState) : null,
      lastPushAuthorized: sameRuntimeScope ? runtime.lastPushAuthorized : null,
      lastPushExecuted: sameRuntimeScope && runtime.lastPushExecuted,
      lastPushRefusalReason: sameRuntimeScope ? code(runtime.lastPushRefusalReason) : null,
      lastErrorCode: sameRuntimeScope ? code(runtime.lastError?.code) : null,
      nextEligibleRetryAt: sameRuntimeScope ? date(runtime.nextEligibleRetryAt) : null,
    },
    discovery: {
      known: discovery.known, complete: discovery.complete, generation: number(discovery.generation),
      downloadsChecked: discovery.downloadsChecked, error: code(discovery.discoveryError), active: discovery.active,
    },
    flights: flights.rows.filter(flight => flight.status === "COMPLETED" && typeof flight.id === "string" && Array.isArray(flight.points) && flight.points.length > 0).map(flight => ({
      flightId: abbreviation(flight.id as string),
      status: "COMPLETED",
      pointCount: (flight.points as unknown[]).length,
      jobs: jobs.rows.filter(job => job.flightId === flight.id && job.scope === scope && job.userId === scope.slice(5)).map(job => ({
        operation: code(job.operation), status: code(job.status), attempts: number(job.attempts),
        lastErrorCode: code(job.lastErrorCode), lastErrorCategory: code(job.lastErrorCategory), nextEligibleRetryAt: date(job.nextEligibleRetryAt),
      })),
      // The current pull persists summary metadata only; remote() has no retained cache.
      // Never infer remote state from an upload/download job or query the server here.
      remote: {
        knowledge: "UNKNOWN_NOT_CACHED", blob_status: null, storage_provider: null,
        has_object_key: null, has_checksum: null, blob_size: null, track_generation: null, deleted_at: null,
      },
    })),
  };
}
