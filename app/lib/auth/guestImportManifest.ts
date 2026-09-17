import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENT_FILES_STORE, BALLOON_DOCUMENTS_STORE } from "../balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "../flightCompletionStorage.ts";
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from "../recordedFlightStorage.ts";
import { guestBusinessStorageKey, scopedIndexedDbName } from "./dataScopeRuntime.ts";

export const SINGLETONS = [
  ["pilot-profile", "balloon-companion-pilot-profile"], ["weather-preferences", "balloon-companion-weather-preferences-v1"],
  ["unit-preferences", "balloon-companion-unit-preferences-v1"], ["aviation-preferences", "balloon-companion-aviation-preferences-v1"],
] as const;
export const LISTS = [
  ["balloon", "balloon-companion-balloons", "balloons"], ["favorite-weather-place", "balloon-companion-favorite-weather-places-v1", "favorites"],
  ["favorite-launch-site", "balloon-companion-favorite-launch-sites-v1", "favorites"], [null, "balloon-companion-pilot-qualifications-v1", "events"],
] as const;
export const FLIGHT_SESSION_KEY = "balloon_companion_flight_session";
export type ManifestEntry = Readonly<{
  identity: string; locator: string; source: "GUEST" | "LEGACY"; kind: "singleton" | "list" | "opening" | "journal" | "ascension" | "flight" | "document";
  key: string; digest: string; value: Record<string, unknown>; file?: Record<string, unknown>; context?: Record<string, unknown>;
}>;
export type GuestImportManifest = Readonly<{ version: 1; id: string; entries: readonly ManifestEntry[] }>;
export type SourceInspection = Readonly<{ state: "EMPTY_VALID" | "NON_EMPTY_VALID"; entries: readonly ManifestEntry[]; signature: string; names: Set<string> }>;

export function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SOURCE");
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("INVALID_SOURCE_LIST");
  const ids = new Set<string>();
  return value.map(row => { const item = plain(row); assertGuestProvenance(item); if (typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("INVALID_SOURCE_ID"); ids.add(item.id); return item; });
}
export function meaningful(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.entries(value).some(([key, v]) => !["version", "initialized"].includes(key) && meaningful(v));
  return value !== null && value !== undefined && value !== "" && value !== false && value !== 0;
}
function assertGuestProvenance(value: Record<string, unknown>): void {
  if (value.__balloonPendingSync !== undefined && !Array.isArray(value.__balloonPendingSync)) throw new Error("INVALID_SOURCE_INTENTS");
  if (value.__balloonDeleted || (Array.isArray(value.__balloonPendingSync) && value.__balloonPendingSync.length)) throw new Error("SOURCE_OWNERSHIP_UNVERIFIABLE");
}
function validateSingleton(domain: typeof SINGLETONS[number][0], value: Record<string, unknown>): void {
  if (domain === "unit-preferences") {
    if (!Object.keys(value).length) return;
    const weather = plain(value.weather), instruments = plain(value.flightInstruments);
    for (const [v, allowed] of [[weather.windSpeedUnit, ["km/h", "kt"]], [weather.temperatureUnit, ["°C", "°F"]], [instruments.speedUnit, ["km/h", "kt"]], [instruments.altitudeUnit, ["m", "ft"]], [instruments.distanceUnit, ["km", "NM"]]] as const) if (!allowed.includes(v as never)) throw new Error("INVALID_UNITS");
  } else {
    for (const [key, field] of Object.entries(value)) {
      if (key === "favorites" && domain === "aviation-preferences") {
        if (!Array.isArray(field) || field.some(item => !item || typeof item !== "object" || typeof item.icao !== "string" || typeof item.name !== "string")) throw new Error("INVALID_SOURCE_LIST");
      } else if (key === "version") { if (typeof field !== "number") throw new Error("INVALID_SINGLETON"); }
      else if (key === "initialized") { if (typeof field !== "boolean") throw new Error("INVALID_SINGLETON"); }
      else if (field !== null && typeof field !== "string") throw new Error("INVALID_SINGLETON");
    }
  }
}

// Tagged tuples prevent JSON's coercions and collisions with user object keys.
async function canonical(value: unknown, ancestors: ReadonlySet<object> = new Set()): Promise<unknown> {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "boolean" || typeof value === "string") return [typeof value, value];
  if (typeof value === "number") return ["number", Number.isNaN(value) ? "NaN" : value === Infinity ? "+Infinity" : value === -Infinity ? "-Infinity" : Object.is(value, -0) ? "-0" : String(value)];
  if (value instanceof Blob) return ["blob", value.type, await digestBytes(await value.arrayBuffer())];
  if (typeof value !== "object") throw new Error("UNSUPPORTED_SOURCE_VALUE");
  if (ancestors.has(value)) throw new Error("CYCLIC_SOURCE_VALUE");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("UNSUPPORTED_SOURCE_KEYS");
  const next = new Set(ancestors); next.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error("UNSUPPORTED_SOURCE_ARRAY");
    return ["array", await Promise.all(Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) ? canonical(value[index], next) : ["hole"]))];
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("UNSUPPORTED_SOURCE_OBJECT");
  return ["object", await Promise.all(Object.keys(value).sort().map(async key => [key, await canonical((value as Record<string, unknown>)[key], next)]))];
}

function validateGpsPoints(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("INVALID_FLIGHT_POINTS");
  for (const row of value) {
    const point = plain(row);
    for (const [key, limit] of [["latitude", 90], ["longitude", 180]] as const) {
      const coordinate = point[key];
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate) || Math.abs(coordinate) > limit) throw new Error("INVALID_GPS_COORDINATE");
    }
    if (typeof point.timestamp !== "number" || !Number.isFinite(point.timestamp)) throw new Error("INVALID_GPS_TIMESTAMP");
    for (const key of ["altitude", "speed", "heading", "accuracy", "verticalAccuracy", "altitudeMeters", "speedMetersPerSecond", "headingDegrees", "horizontalAccuracyMeters", "verticalAccuracyMeters", "receivedAt", "gpsTimestamp", "callbackSequence", "deliveryLatencyMs", "deltaGpsTimestampMs", "deltaReceivedAtMs", "lastPointTimestamp", "deltaTimeSincePreviousPoint"]) {
      if (point[key] !== undefined && point[key] !== null && (typeof point[key] !== "number" || !Number.isFinite(point[key]))) throw new Error("INVALID_GPS_NUMBER");
    }
  }
}
async function digestBytes(bytes: ArrayBuffer): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join(""); }
export async function fingerprint(value: unknown): Promise<string> { return digestBytes(new TextEncoder().encode(JSON.stringify(await canonical(value))).buffer); }
export async function makeGuestManifest(entries: readonly ManifestEntry[]): Promise<GuestImportManifest> {
  const sorted = [...entries].sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0);
  return { version: 1, id: await fingerprint(sorted.map(({ identity, locator, digest }) => ({ identity, locator, digest }))), entries: sorted };
}
export async function openExistingGuestSource(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("SOURCE_CHANGED")); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("SOURCE_BLOCKED"));
  });
}
export async function readSourceRows(db: IDBDatabase, store: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly"), request = tx.objectStore(store).getAll();
    tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("SOURCE_READ_FAILED"));
  });
}

async function readDocumentSource(db: IDBDatabase): Promise<{ values: Record<string, unknown>[]; files: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([BALLOON_DOCUMENTS_STORE, BALLOON_DOCUMENT_FILES_STORE], "readonly");
    const metadata = tx.objectStore(BALLOON_DOCUMENTS_STORE).getAll(), files = tx.objectStore(BALLOON_DOCUMENT_FILES_STORE).getAll();
    tx.oncomplete = () => resolve({ values: metadata.result, files: files.result });
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("SOURCE_READ_FAILED"));
  });
}

/** Read-only, including files. The signature covers present empty sources too. */
export async function inspectGuestSources(storage: Storage, factory: IDBFactory, assertCurrent: () => void): Promise<SourceInspection> {
  assertCurrent();
  if (!factory.databases) throw new Error("SOURCE_DISCOVERY_UNAVAILABLE");
  const names = new Set((await factory.databases()).map(db => db.name).filter((name): name is string => !!name));
  assertCurrent();
  const entries: ManifestEntry[] = [], signatures: unknown[] = [];
  async function add(kind: ManifestEntry["kind"], key: string, source: ManifestEntry["source"], value: Record<string, unknown>, natural?: string, file?: Record<string, unknown>, context?: Record<string, unknown>) {
    const digest = await fingerprint({ value, file, context }); assertCurrent();
    const identity = natural ?? `${kind}:${key}:sha256:${await fingerprint(value)}`;
    entries.push({ identity, locator: `${source}:${key}:${kind}:${natural ?? identity}`, source, kind, key, digest, value: structuredClone(value), ...(file ? { file: structuredClone(file) } : {}), ...(context ? { context: structuredClone(context) } : {}) });
  }
  const keys = [...SINGLETONS.map(([, key]) => key), ...LISTS.map(([, key]) => key), FLIGHT_COMPLETION_STORAGE_KEY, FLIGHT_SESSION_KEY];
  for (const key of keys) for (const source of ["GUEST", "LEGACY"] as const) {
    assertCurrent(); const raw = storage.getItem(source === "GUEST" ? guestBusinessStorageKey(key) : key); if (raw === null) continue;
    const value = plain(JSON.parse(raw)); assertGuestProvenance(value); signatures.push([source, key, await fingerprint(value)]); assertCurrent();
    const singleton = SINGLETONS.find(([, candidate]) => candidate === key);
    if (singleton) {
      validateSingleton(singleton[0], value);
      if (meaningful(value)) await add("singleton", key, source, value);
    } else if (key === FLIGHT_COMPLETION_STORAGE_KEY) {
      const opening = plain(value.openingBalance), journal = rows(value.journalFlights), ascensions = rows(value.officialAscensions);
      if (opening.confirmed !== undefined && typeof opening.confirmed !== "boolean") throw new Error("INVALID_OPENING");
      if (["ascensions", "officialDurationMinutes"].some(k => opening[k] != null && (typeof opening[k] !== "number" || !Number.isFinite(opening[k]) || Number(opening[k]) < 0))) throw new Error("INVALID_OPENING");
      if (opening.confirmed === true || Number(opening.ascensions) > 0 || Number(opening.officialDurationMinutes) > 0) await add("opening", key, source, opening);
      for (const item of journal) await add("journal", key, source, item, `flight:${typeof item.sourceFlightId === "string" ? item.sourceFlightId : item.id}`);
      for (const item of ascensions) await add("ascension", key, source, item, `logbook-entry:${item.id}`);
    } else if (key === FLIGHT_SESSION_KEY) {
      if (!Array.isArray(value.points) || typeof value.status !== "string") throw new Error("INVALID_SESSION");
      validateGpsPoints(value.points);
      if (value.points.length) await add("singleton", key, source, value);
    } else {
      const [domain, , property] = LISTS.find(([, candidate]) => candidate === key)!;
      const list = rows(value[property]);
      for (const item of list) await add("list", key, source, item, `${domain ?? "pilot-qualifications"}:${item.id}`, undefined, key === "balloon-companion-balloons" && typeof value.activeBalloonId === "string" ? { activeBalloonId: value.activeBalloonId } : undefined);
      if (domain === null && value.profile !== undefined && meaningful(plain(value.profile))) await add("singleton", key, source, plain(value.profile));
    }
  }
  for (const [base, store, kind] of [[RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE, "flight"], [BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE, "document"]] as const) {
    for (const source of ["GUEST", "LEGACY"] as const) {
      const name = source === "GUEST" ? scopedIndexedDbName("GUEST", base) : base; if (!names.has(name)) continue;
      assertCurrent(); const db = await openExistingGuestSource(factory, name);
      try {
        assertCurrent(); if (!db.objectStoreNames.contains(store)) throw new Error("INVALID_SOURCE_STORE");
        const snapshot = kind === "document" ? await readDocumentSource(db) : { values: await readSourceRows(db, store), files: [] };
        const values = rows(snapshot.values), files = snapshot.files.map(plain);
        if (files.some(file => typeof file.documentId !== "string" || !values.some(value => value.id === file.documentId) || (!(file.blob instanceof Blob) && !(file.file instanceof Blob)))) throw new Error("INVALID_DOCUMENT_FILE");
        assertCurrent(); signatures.push([name, await fingerprint({ values, files })]);
        for (const value of values) {
          assertGuestProvenance(value);
          if (kind === "flight") validateGpsPoints(value.points);
          const file = files.find(file => file.documentId === value.id);
          if (file && !(file.blob instanceof Blob) && !(file.file instanceof Blob)) throw new Error("INVALID_DOCUMENT_FILE");
          await add(kind, base, source, value, `${kind === "flight" ? "flight" : "balloon-document"}:${value.id}`, file);
        }
      } finally { db.close(); }
    }
  }
  assertCurrent(); return { state: entries.length ? "NON_EMPTY_VALID" : "EMPTY_VALID", entries, signature: await fingerprint(signatures), names };
}

/** Reconstruct only the claimed entries, never a current guest container. */
export function manifestSourceValues(manifest: GuestImportManifest, key: string): readonly { source: "GUEST" | "LEGACY"; raw: string }[] {
  const results: { source: "GUEST" | "LEGACY"; raw: string }[] = [];
  for (const source of ["GUEST", "LEGACY"] as const) {
    const entries = manifest.entries.filter(entry => entry.key === key && entry.source === source); if (!entries.length) continue;
    const list = LISTS.find(([, candidate]) => candidate === key);
    let value: Record<string, unknown>;
    if (key === FLIGHT_COMPLETION_STORAGE_KEY) value = { version: 2, openingBalance: entries.find(e => e.kind === "opening")?.value ?? {}, journalFlights: entries.filter(e => e.kind === "journal").map(e => e.value), officialAscensions: entries.filter(e => e.kind === "ascension").map(e => e.value) };
    else if (list) {
      value = { [list[2]]: entries.filter(e => e.kind === "list").map(e => e.value) };
      const profile = entries.find(e => e.kind === "singleton"); if (profile) value.profile = profile.value;
      const active = entries.find(e => e.context?.activeBalloonId && entries.some(item => item.value.id === e.context?.activeBalloonId))?.context?.activeBalloonId;
      if (active) value.activeBalloonId = active;
    } else value = entries[0]!.value;
    results.push({ source, raw: JSON.stringify(value) });
  }
  return results;
}
