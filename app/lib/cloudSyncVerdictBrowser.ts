import { isLocalSyncRecoveryRunning } from "./durableSyncIntent.ts";
import { getRuntimeDataScope, getRuntimeAuthState, scopedBusinessStorageKey, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import { CLOUD_SYNC_BUSINESS_STORAGE_KEYS, cloudSyncVerdictGeneration, cloudSyncObservationVersion, cloudSyncRuntimeToken, CloudSyncVerdictAcceptance, inspectCloudSyncVerdict, type CloudSyncVerdict, type CloudSyncEvidence } from "./cloudSyncVerdict.ts";
import type { CloudSyncRuntimeControllerSnapshot } from "./cloudSyncRuntimeController.ts";
import type { SyncMutation } from "./syncOutbox.ts";
import type { FlightTrackJob } from "./flightTrackQueue.ts";
import type { CloudSyncIssue } from "./cloudSyncService.ts";

export const LOCAL_SYNC_INSPECTION_TIMEOUT_MS = 8_000;
export function withLocalSyncInspectionTimeout<T>(operation: Promise<T>, timeoutMs = LOCAL_SYNC_INSPECTION_TIMEOUT_MS, disposeLateValue?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; reject(new Error("LOCAL_SYNC_INSPECTION_TIMEOUT")); }, timeoutMs);
    operation.then(value => { if (timedOut) disposeLateValue?.(value); else resolve(value); }, reject).finally(() => clearTimeout(timer));
  });
}

/** No creation/upgrade, no write transaction, no replay. A vanished DB aborts. */
export async function readExistingSyncStore(factory: IDBFactory, names: readonly IDBDatabaseInfo[], name: string, store: string, project: (value: Record<string, unknown>) => Record<string, unknown> = value => value): Promise<Record<string, unknown>[]> {
  if (!names.some(db => db.name === name)) return [];
  const db = await withLocalSyncInspectionTimeout(new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("DATABASE_CHANGED")); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("DATABASE_BLOCKED"));
    request.onsuccess = () => resolve(request.result);
  }), LOCAL_SYNC_INSPECTION_TIMEOUT_MS, database => database.close());
  try {
    return await withLocalSyncInspectionTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const rows: Record<string, unknown>[] = [];
      const request = tx.objectStore(store).openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; const value = cursor.value; if (!value || typeof value !== "object") { tx.abort(); return; } try { rows.push(project(value)); cursor.continue(); } catch { tx.abort(); } };
      tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("INVALID_RECORD"));
    }));
  } finally { db.close(); }
}
export function countStoredSyncIntents(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const intents = (value as Record<string, unknown>).__balloonPendingSync;
  if (intents === undefined) return 0;
  if (!Array.isArray(intents) || intents.some(i => !i || typeof i.mutationId !== "string" || typeof i.entityType !== "string" || typeof i.entityId !== "string" || !["UPSERT", "DELETE"].includes(i.operation))) throw new Error("INVALID_INTENT");
  return intents.length;
}
// Explicitly local operational data and protocol bookkeeping, never cloud coverage.
const excludedStorageKeys = new Set([
  "balloon_companion_flight_session", "balloon_companion_trajectory_analysis_request", "balloon_companion_weather_analysis_v1",
  "balloon_companion_planned_trajectories_v1", "balloon_companion_flight_weather_snapshot_v1", "balloon-companion-cloud-pull-cursors-v1",
  "balloon-companion-cloud-sync-issues-v1",
]);
const singletons: Record<string, string> = {
  "balloon-companion-pilot-profile": "pilot-profile", "balloon-companion-unit-preferences-v1": "unit-preferences",
  "balloon-companion-weather-preferences-v1": "weather-preferences", "balloon-companion-aviation-preferences-v1": "aviation-preferences",
  "balloon-companion-pilot-qualifications-v1": "pilot-qualifications",
};
export async function readBrowserCloudSyncEvidence(scope: `USER:${string}`, runtime: CloudSyncRuntimeControllerSnapshot, trace: Readonly<{ complete: boolean; generation: number | null; active: boolean; downloadsChecked?: boolean; discoveryError?: string | null }>): Promise<CloudSyncEvidence> {
  const storage = window.localStorage, factory = indexedDB;
  if (!factory.databases) throw new Error("DATABASE_ENUMERATION_UNAVAILABLE");
  const names = await withLocalSyncInspectionTimeout(factory.databases());
  const read = (name: string, store: string) => readExistingSyncStore(factory, names, scopedIndexedDbName(scope, name), store, value => name === "balloon-companion-flights" ? {
    id: value.id, status: value.status, pointsValid: Array.isArray(value.points), pointCount: Array.isArray(value.points) ? value.points.length : null,
    __balloonDeleted: value.__balloonDeleted, __balloonPendingSync: value.__balloonPendingSync,
  } : value);
  const [mutations, metadata, documents, flights, tracks] = await Promise.all([
    read("balloon-companion-sync-v1", "mutations"), read("balloon-companion-sync-v1", "metadata"),
    read("balloon-companion-documents", "documents"), read("balloon-companion-flights", "flights"),
    read("balloon-companion-flight-track-queue-v1", "jobs"),
  ]);
  let intents = 0, coverageComplete = true;
  const known = new Set(metadata.filter(m => typeof m.revision === "number" && m.revision > 0 && !m.deletedAt).map(m => `${m.entityType}:${m.entityId}`));
  const deletedKnown = new Set(metadata.filter(m => typeof m.deletedAt === "string").map(m => `${m.entityType}:${m.entityId}`));
  const requireKnown = (type: string, id: unknown) => { if (typeof id !== "string" || !known.has(`${type}:${id}`)) coverageComplete = false; };
  const prefix = scopedBusinessStorageKey(scope, "");
  let issues: CloudSyncIssue[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key); if (raw === null) throw new Error("STORAGE_CHANGED");
    const value = JSON.parse(raw); const legacy = key.slice(prefix.length);
    if (!CLOUD_SYNC_BUSINESS_STORAGE_KEYS.has(legacy) && !excludedStorageKeys.has(legacy)) coverageComplete = false;
    intents += countStoredSyncIntents(value);
    if (legacy === "balloon-companion-cloud-sync-issues-v1") {
      if (!Array.isArray(value) || value.some(v => !v || !["CONFLICT", "BUSINESS_CONFLICT", "NOT_FOUND"].includes(v.kind) || typeof v.entityType !== "string" || typeof v.entityId !== "string" || (v.kind === "BUSINESS_CONFLICT" && (v.businessCode !== "DUPLICATE_REGISTRATION" || v.entityType !== "balloon")))) throw new Error("INVALID_ISSUES");
      issues = value;
    }
    if (singletons[legacy]) { if (!value || typeof value !== "object") throw new Error("INVALID_BUSINESS_VALUE"); requireKnown(singletons[legacy]!, "singleton"); }
    for (const [storageKey, property, type] of [
      ["balloon-companion-favorite-launch-sites-v1", "favorites", "favorite-launch-site"],
      ["balloon-companion-favorite-weather-places-v1", "favorites", "favorite-weather-place"],
      ["balloon-companion-balloons", "balloons", "balloon"],
      ["balloon-companion-flight-completion-v1", "officialAscensions", "logbook-entry"],
    ]) if (legacy === storageKey) {
      if (!value || !Array.isArray(value[property!])) throw new Error("INVALID_BUSINESS_LIST");
      for (const record of value[property!]) requireKnown(type!, record?.id);
      if (legacy === "balloon-companion-balloons" && value.activeBalloonId) requireKnown("balloon-preferences", "singleton");
      if (legacy === "balloon-companion-flight-completion-v1") {
        if (value.openingBalance?.confirmed) requireKnown("pilot-profile", "singleton");
        if (!Array.isArray(value.journalFlights)) throw new Error("INVALID_JOURNAL");
        for (const f of value.journalFlights) { requireKnown("flight", f.sourceFlightId ?? f.id); if (!flights.some(row => row.id === (f.sourceFlightId ?? f.id))) coverageComplete = false; }
      }
    }
  }
  for (const [rows, type] of [[documents, "balloon-document"], [flights, "flight"]] as const) for (const row of rows) {
    intents += countStoredSyncIntents(row);
    if (!row.__balloonDeleted) requireKnown(type, row.id);
    else if (!deletedKnown.has(`${type}:${row.id}`)) coverageComplete = false;
  }
  if (flights.some(f => !f.__balloonDeleted && !f.pointsValid)) throw new Error("INVALID_FLIGHT");
  if (mutations.some(m => typeof m.mutationId !== "string" || typeof m.entityType !== "string" || typeof m.entityId !== "string" || !["UPSERT", "DELETE"].includes(String(m.operation)) || typeof m.attempts !== "number")) throw new Error("INVALID_MUTATION");
  if (metadata.some(m => typeof m.entityType !== "string" || typeof m.entityId !== "string" || typeof m.revision !== "number" || !Number.isSafeInteger(m.revision) || m.revision < 0)) throw new Error("INVALID_METADATA");
  if (tracks.some(j => j.scope !== scope || j.userId !== scope.slice(5) || !["PENDING", "FAILED"].includes(String(j.status)))) throw new Error("INVALID_TRACK_JOB");
  return { mutations: mutations as unknown as SyncMutation[], intents, issues, tracks: tracks as unknown as FlightTrackJob[], traceActive: trace.active, recoveryActive: isLocalSyncRecoveryRunning(scope), traceDiscoveryComplete: trace.complete && (trace.downloadsChecked === true || !flights.some(f => !f.__balloonDeleted && f.status === "COMPLETED" && (!f.pointsValid || f.pointCount === 0))), traceDiscoveryError: trace.discoveryError ?? null, coverageComplete, passGeneration: runtime.lastPushState === "COMPLETED" ? trace.generation : null };
}
const acceptance = new CloudSyncVerdictAcceptance();
export async function inspectBrowserCloudSyncVerdict(runtime: () => CloudSyncRuntimeControllerSnapshot, trace: () => Readonly<{complete: boolean; generation: number | null; active: boolean; downloadsChecked?: boolean}>) {
  const verdict = await inspectCloudSyncVerdict({ getScope: getRuntimeDataScope, getGeneration: cloudSyncVerdictGeneration, getObservationVersion: cloudSyncObservationVersion, activityToken: () => JSON.stringify(trace()), runtime, online: () => navigator.onLine && getRuntimeAuthState() === "SIGNED_IN", authKnown: () => getRuntimeAuthState() !== "UNKNOWN", read: scope => readBrowserCloudSyncEvidence(scope, runtime(), trace()) });
  return { ...verdict, verifiedAt: verdict.state === "SYNCED" ? verdict.verifiedAt : acceptance.lastVerifiedAt(verdict.scope) };
}

export function acceptBrowserCloudSyncVerdict(verdict: CloudSyncVerdict, runtime: () => CloudSyncRuntimeControllerSnapshot, trace: () => Readonly<{complete: boolean; generation: number | null; active: boolean}>, applicable = true): CloudSyncVerdict | null {
  return acceptance.accept(verdict, { applicable, scope: getRuntimeDataScope(), generation: cloudSyncVerdictGeneration(), observation: cloudSyncObservationVersion(), runtime: cloudSyncRuntimeToken(runtime()), activity: JSON.stringify(trace()), online: navigator.onLine && getRuntimeAuthState() === "SIGNED_IN" });
}
