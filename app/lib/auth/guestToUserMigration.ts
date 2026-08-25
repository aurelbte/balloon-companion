import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENT_FILES_STORE, BALLOON_DOCUMENTS_STORE } from "../balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "../flightCompletionStorage.ts";
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from "../recordedFlightStorage.ts";
import { IndexedDbSyncOutboxStorage } from "../syncOutbox.ts";
import { guestBusinessStorageKey, scopedBusinessStorageKey, scopedIndexedDbName } from "./dataScopeRuntime.ts";

export const GUEST_TO_USER_MIGRATION_KEY = "balloon-companion-guest-to-user-migration-v1";

const SINGLETONS = [
  ["pilot-profile", "balloon-companion-pilot-profile"],
  ["weather-preferences", "balloon-companion-weather-preferences-v1"],
  ["unit-preferences", "balloon-companion-unit-preferences-v1"],
  ["aviation-preferences", "balloon-companion-aviation-preferences-v1"],
] as const;
const LISTS = [
  ["balloon", "balloon-companion-balloons", "balloons"],
  ["favorite-weather-place", "balloon-companion-favorite-weather-places-v1", "favorites"],
  ["favorite-launch-site", "balloon-companion-favorite-launch-sites-v1", "favorites"],
  [null, "balloon-companion-pilot-qualifications-v1", "events"],
] as const;
const FLIGHT_SESSION_KEY = "balloon_companion_flight_session";

export type GuestToUserMigrationCollision = Readonly<{ domain: string; entityId: string; source: "GUEST" | "LEGACY" }>;
export type GuestToUserMigrationReport = Readonly<{
  state: "COMPLETE" | "COMPLETE_WITH_COLLISIONS";
  imported: number;
  collisions: readonly GuestToUserMigrationCollision[];
  completedDomains: readonly string[];
}>;

type Marker = Readonly<{ userId: string; deviceId: string; completedDomains: readonly string[]; collisions: readonly GuestToUserMigrationCollision[]; completedAt?: string }>;
type MigrationOutbox = Pick<IndexedDbSyncOutboxStorage, "enqueue">;

export function selectAbsentMigrationRecords(destination: readonly Record<string, unknown>[], incoming: readonly Record<string, unknown>[]) {
  const known = [...destination], additions: Record<string, unknown>[] = [], conflicts: string[] = [];
  for (const value of incoming) {
    const id = typeof value?.id === "string" ? value.id : null; if (!id) continue;
    const existing = known.find((item) => item.id === id);
    if (!existing) { additions.push(value); known.push(value); } else if (!same(existing, value)) conflicts.push(id);
  }
  return { additions, conflicts } as const;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function parsed(raw: string | null): unknown { try { return raw === null ? null : JSON.parse(raw); } catch { return null; } }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function records(value: unknown, property: string): Record<string, unknown>[] { const list = object(value)[property]; return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")) : []; }
function sourceValues(storage: Storage, key: string): readonly { source: "LEGACY" | "GUEST"; raw: string }[] {
  const legacy = storage.getItem(key), guest = storage.getItem(guestBusinessStorageKey(key));
  // Le namespace GUEST v2 est la source active la plus récente; le legacy non
  // scopé ne complète ensuite que les données absentes et ne peut l'écraser.
  return [...(guest === null ? [] : [{ source: "GUEST" as const, raw: guest }]), ...(legacy === null ? [] : [{ source: "LEGACY" as const, raw: legacy }])];
}
function markerId(userId: string, deviceId: string): string { return `${userId}:${deviceId}`; }
function emptySingleton(entityType: typeof SINGLETONS[number][0], raw: string | null): boolean {
  if (raw === null) return true; const value = object(parsed(raw));
  if (entityType === "pilot-profile") return ["firstName", "lastName", "licenseNumber", "flightTestDueDateIso", "medicalDueDateIso"].every((key) => !value[key]) && !value.usualFunction;
  if (entityType === "weather-preferences") return !value.favoriteWeatherLocationId && !value.weatherModel;
  if (entityType === "aviation-preferences") return !value.airportIcao && (!Array.isArray(value.favorites) || value.favorites.length === 0);
  return false;
}
function markers(storage: Storage): Record<string, Marker> { const value = parsed(storage.getItem(GUEST_TO_USER_MIGRATION_KEY)); return object(value) as Record<string, Marker>; }
function saveMarker(storage: Storage, marker: Marker): void { storage.setItem(GUEST_TO_USER_MIGRATION_KEY, JSON.stringify({ ...markers(storage), [markerId(marker.userId, marker.deviceId)]: marker })); }

export function guestToUserMigrationComplete(storage: Storage, userId: string, deviceId: string): boolean {
  const marker = markers(storage)[markerId(userId, deviceId)];
  return Boolean(marker?.completedAt);
}

function mergeList(base: unknown, incoming: unknown, property: string, domain: string, source: "GUEST" | "LEGACY", collisions: GuestToUserMigrationCollision[]) {
  const destination = records(base, property), additions: Record<string, unknown>[] = [];
  for (const item of records(incoming, property)) {
    const existing = [...destination, ...additions].find(({ id }) => id === item.id);
    if (!existing) additions.push(item);
    else if (!same(existing, item)) collisions.push({ domain, entityId: String(item.id), source });
  }
  return { value: { ...object(incoming), ...object(base), [property]: [...destination, ...additions] }, additions };
}

function journalIdentity(item: Record<string, unknown>): string { return typeof item.sourceFlightId === "string" ? item.sourceFlightId : String(item.id); }
function mergeCompletion(base: unknown, incoming: unknown, source: "GUEST" | "LEGACY", collisions: GuestToUserMigrationCollision[]) {
  const current = object(base), candidate = object(incoming);
  const merge = (property: "journalFlights" | "officialAscensions", identity: (item: Record<string, unknown>) => string) => {
    const destination = records(current, property), additions: Record<string, unknown>[] = [];
    for (const item of records(candidate, property)) {
      const id = identity(item); const existing = [...destination, ...additions].find((entry) => identity(entry) === id);
      if (!existing) additions.push(item); else if (!same(existing, item)) collisions.push({ domain: property, entityId: id, source });
    }
    return { all: [...destination, ...additions], additions };
  };
  const journal = merge("journalFlights", journalIdentity), ascensions = merge("officialAscensions", (item) => String(item.id));
  const currentOpening = object(current.openingBalance), incomingOpening = object(candidate.openingBalance);
  const currentOpeningEmpty = currentOpening.confirmed !== true && currentOpening.ascensions == null && currentOpening.officialDurationMinutes == null;
  let openingBalance = currentOpeningEmpty ? incomingOpening : currentOpening;
  if (!currentOpeningEmpty && Object.keys(incomingOpening).length && !same(currentOpening, incomingOpening)) collisions.push({ domain: "opening-balance", entityId: "singleton", source });
  if (!Object.keys(openingBalance).length) openingBalance = incomingOpening;
  return { value: { ...candidate, ...current, openingBalance, journalFlights: journal.all, officialAscensions: ascensions.all }, journalAdditions: journal.additions, ascensionAdditions: ascensions.additions };
}

async function databaseNames(factory: IDBFactory): Promise<Set<string>> { return typeof factory.databases === "function" ? new Set((await factory.databases()).map(({ name }) => name).filter((name): name is string => Boolean(name))) : new Set(); }
function open(factory: IDBFactory, name: string, stores: readonly string[] = []): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = factory.open(name, 1); request.onupgradeneeded = () => { for (const store of stores) if (!request.result.objectStoreNames.contains(store)) { const created = request.result.createObjectStore(store, { keyPath: store === "activeFlight" ? "key" : store === BALLOON_DOCUMENT_FILES_STORE ? "documentId" : "id" }); if (store === BALLOON_DOCUMENTS_STORE) created.createIndex("balloonId", "balloonId", { unique: false }); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function transactionDone(value: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { value.oncomplete = () => resolve(); value.onerror = () => reject(value.error); value.onabort = () => reject(value.error); }); }

async function copyIndexedDbCollection(input: Readonly<{ factory: IDBFactory; names: Set<string>; sources: readonly { name: string; source: "LEGACY" | "GUEST" }[]; destination: string; store: string; domain: string; userId: string; collisions: GuestToUserMigrationCollision[]; outbox: MigrationOutbox; relatedFileStore?: string }>): Promise<number> {
  let imported = 0; const destination = await open(input.factory, input.destination, [input.store, ...(input.relatedFileStore ? [input.relatedFileStore] : []), ...(input.domain === "flight" ? ["activeFlight"] : [])]);
  const known = await request(destination.transaction(input.store, "readonly").objectStore(input.store).getAll()) as Array<Record<string, unknown>>;
  for (const sourceDefinition of input.sources) {
    if (!input.names.has(sourceDefinition.name)) continue;
    const source = await open(input.factory, sourceDefinition.name);
    if (!source.objectStoreNames.contains(input.store)) { source.close(); continue; }
    const values = await request(source.transaction(input.store, "readonly").objectStore(input.store).getAll()) as Array<Record<string, unknown>>;
    const plan = selectAbsentMigrationRecords(known, values);
    for (const id of plan.conflicts) input.collisions.push({ domain: input.domain, entityId: id, source: sourceDefinition.source });
    for (const value of plan.additions) {
      const id = value.id as string;
      const stores = input.relatedFileStore && destination.objectStoreNames.contains(input.relatedFileStore) ? [input.store, input.relatedFileStore] : [input.store];
      const file = input.relatedFileStore && source.objectStoreNames.contains(input.relatedFileStore)
        ? await request(source.transaction(input.relatedFileStore, "readonly").objectStore(input.relatedFileStore).get(id)) : null;
      await input.outbox.enqueue({ entityType: input.domain, entityId: id, operation: "UPSERT", baseRevision: 0 });
      const transaction = destination.transaction(stores, "readwrite"); transaction.objectStore(input.store).add(value);
      if (file && input.relatedFileStore && stores.includes(input.relatedFileStore)) transaction.objectStore(input.relatedFileStore).add(file);
      await transactionDone(transaction); known.push(value); imported += 1;
    }
    source.close();
  }
  destination.close(); return imported;
}

export async function migrateGuestAndLegacyToUser(input: Readonly<{ userId: string; deviceId: string; storage: Storage; factory?: IDBFactory; outbox?: MigrationOutbox }>): Promise<GuestToUserMigrationReport> {
  const scope = `USER:${input.userId}` as const, outbox = input.outbox ?? new IndexedDbSyncOutboxStorage(scope);
  const previous = markers(input.storage)[markerId(input.userId, input.deviceId)];
  if (previous?.completedAt) return { state: previous.collisions.length ? "COMPLETE_WITH_COLLISIONS" : "COMPLETE", imported: 0, collisions: previous.collisions, completedDomains: previous.completedDomains };
  const completed = new Set(previous?.completedDomains ?? []), collisions = [...(previous?.collisions ?? [])]; let imported = 0;
  const checkpoint = (domain: string) => { completed.add(domain); saveMarker(input.storage, { userId: input.userId, deviceId: input.deviceId, completedDomains: [...completed], collisions }); };

  for (const [entityType, key] of SINGLETONS) {
    if (completed.has(key)) continue;
    const destinationKey = scopedBusinessStorageKey(scope, key); let destination = input.storage.getItem(destinationKey);
    for (const source of sourceValues(input.storage, key)) {
      if (Object.keys(object(parsed(source.raw))).length === 0) continue;
      if (emptySingleton(entityType, destination)) { await outbox.enqueue({ entityType, entityId: "singleton", operation: "UPSERT", baseRevision: 0 }); input.storage.setItem(destinationKey, source.raw); destination = source.raw; imported += 1; }
      else if (!same(parsed(destination), parsed(source.raw))) collisions.push({ domain: entityType, entityId: "singleton", source: source.source });
    }
    checkpoint(key);
  }
  for (const [entityType, key, property] of LISTS) {
    if (completed.has(key)) continue;
    const destinationKey = scopedBusinessStorageKey(scope, key); let destination = parsed(input.storage.getItem(destinationKey));
    for (const source of sourceValues(input.storage, key)) {
      const result = mergeList(destination, parsed(source.raw), property, entityType ?? "pilot-qualifications", source.source, collisions);
      if (result.additions.length) {
        if (entityType) for (const item of result.additions) await outbox.enqueue({ entityType, entityId: String(item.id), operation: "UPSERT", baseRevision: 0 });
        destination = result.value; input.storage.setItem(destinationKey, JSON.stringify(destination)); imported += result.additions.length;
      }
    }
    checkpoint(key);
  }
  if (!completed.has(FLIGHT_COMPLETION_STORAGE_KEY)) {
    const destinationKey = scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY); let destination = parsed(input.storage.getItem(destinationKey));
    for (const source of sourceValues(input.storage, FLIGHT_COMPLETION_STORAGE_KEY)) {
      const sourceValue = parsed(source.raw), sourceRecord = object(sourceValue);
      if (!sourceRecord.openingBalance || !Array.isArray(sourceRecord.journalFlights) || !Array.isArray(sourceRecord.officialAscensions)) continue;
      const result = mergeCompletion(destination, sourceValue, source.source, collisions);
      if (result.journalAdditions.length || result.ascensionAdditions.length || !input.storage.getItem(destinationKey)) {
        await outbox.enqueue({ entityType: "flight-completion", entityId: "singleton", operation: "UPSERT", baseRevision: 0 });
        for (const item of result.journalAdditions) await outbox.enqueue({ entityType: "flight", entityId: journalIdentity(item), operation: "UPSERT", baseRevision: 0 });
        for (const item of result.ascensionAdditions) await outbox.enqueue({ entityType: "logbook-entry", entityId: String(item.id), operation: "UPSERT", baseRevision: 0 });
        destination = result.value; input.storage.setItem(destinationKey, JSON.stringify(destination)); imported += result.journalAdditions.length + result.ascensionAdditions.length;
      }
    }
    checkpoint(FLIGHT_COMPLETION_STORAGE_KEY);
  }
  if (!completed.has(FLIGHT_SESSION_KEY)) {
    const destinationKey = scopedBusinessStorageKey(scope, FLIGHT_SESSION_KEY); let destination = input.storage.getItem(destinationKey);
    for (const source of sourceValues(input.storage, FLIGHT_SESSION_KEY)) {
      const sourceRecord = object(parsed(source.raw)); if (!Array.isArray(sourceRecord.points) || typeof sourceRecord.status !== "string") continue;
      if (destination === null) { input.storage.setItem(destinationKey, source.raw); destination = source.raw; imported += 1; }
      else if (!same(parsed(destination), parsed(source.raw))) collisions.push({ domain: "flight-session", entityId: "current", source: source.source });
    }
    checkpoint(FLIGHT_SESSION_KEY);
  }
  if (input.factory) {
    const names = await databaseNames(input.factory);
    if (!completed.has("recorded-flights")) {
      imported += await copyIndexedDbCollection({ factory: input.factory, names, sources: [{ name: scopedIndexedDbName("GUEST", RECORDED_FLIGHT_DB_NAME), source: "GUEST" }, { name: RECORDED_FLIGHT_DB_NAME, source: "LEGACY" }], destination: scopedIndexedDbName(scope, RECORDED_FLIGHT_DB_NAME), store: RECORDED_FLIGHTS_STORE, domain: "flight", userId: input.userId, collisions, outbox }); checkpoint("recorded-flights");
    }
    if (!completed.has("documents")) {
      imported += await copyIndexedDbCollection({ factory: input.factory, names, sources: [{ name: scopedIndexedDbName("GUEST", BALLOON_DOCUMENT_DB_NAME), source: "GUEST" }, { name: BALLOON_DOCUMENT_DB_NAME, source: "LEGACY" }], destination: scopedIndexedDbName(scope, BALLOON_DOCUMENT_DB_NAME), store: BALLOON_DOCUMENTS_STORE, relatedFileStore: BALLOON_DOCUMENT_FILES_STORE, domain: "balloon-document", userId: input.userId, collisions, outbox }); checkpoint("documents");
    }
  }
  const marker = { userId: input.userId, deviceId: input.deviceId, completedDomains: [...completed], collisions, completedAt: new Date().toISOString() };
  saveMarker(input.storage, marker);
  return { state: collisions.length ? "COMPLETE_WITH_COLLISIONS" : "COMPLETE", imported, collisions, completedDomains: marker.completedDomains };
}
