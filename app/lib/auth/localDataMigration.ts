import {
  BALLOON_DOCUMENT_DB_NAME,
  BALLOON_DOCUMENT_FILES_STORE,
  BALLOON_DOCUMENTS_STORE,
} from "../balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "../flightCompletionStorage.ts";
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from "../recordedFlightStorage.ts";
import type { KeyValueStorage } from "./deviceIdentity.ts";
import { scopedBusinessStorageKey, scopedIndexedDbName } from "./dataScopeRuntime.ts";

export type MigrationCollection = "flights" | "journal" | "balloons" | "documents" | "preferences";
export type MigrationRecord = Readonly<{ collection: MigrationCollection; id: string; value: unknown }>;
export type MigrationFailure = Readonly<{ state: "MIGRATION_FAILED"; collection: MigrationCollection; id: string; reason: "CONFLICT" | "COPY_FAILED" | "VERIFY_FAILED" }>;
export type LocalDataMigrationState = "MIGRATION_APPROVED" | "MIGRATION_COPYING" | "MIGRATION_VERIFYING" | "MIGRATION_COMPLETE" | MigrationFailure;

export type LocalDataMigrationRepository = Readonly<{
  listLegacy(): Promise<readonly MigrationRecord[]>;
  getScoped(scope: `USER:${string}`, collection: MigrationCollection, id: string): Promise<MigrationRecord | null>;
  putScoped(scope: `USER:${string}`, record: MigrationRecord): Promise<void>;
  listScoped(scope: `USER:${string}`, collection: MigrationCollection): Promise<readonly MigrationRecord[]>;
  markComplete(input: Readonly<{ userId: string; deviceId: string; completedAt: string }>): void;
}>;

async function contentEqual(left: unknown, right: unknown): Promise<boolean> {
  if (Object.is(left, right)) return true;
  if (typeof Blob !== "undefined" && left instanceof Blob && right instanceof Blob) {
    if (left.size !== right.size || left.type !== right.type) return false;
    const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()]);
    return new Uint8Array(a).every((value, index) => value === new Uint8Array(b)[index]);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return (await Promise.all(left.map((value, index) => contentEqual(value, right[index])))).every(Boolean);
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord).sort();
    if (keys.join("\0") !== Object.keys(rightRecord).sort().join("\0")) return false;
    return (await Promise.all(keys.map((key) => contentEqual(leftRecord[key], rightRecord[key])))).every(Boolean);
  }
  return false;
}

export async function migrateApprovedLegacyData(input: Readonly<{
  userId: string;
  deviceId: string;
  repository: LocalDataMigrationRepository;
  now?: () => string;
  onState?: (state: LocalDataMigrationState) => void;
}>): Promise<LocalDataMigrationState> {
  const scope = `USER:${input.userId}` as const;
  input.onState?.("MIGRATION_COPYING");
  const legacy = await input.repository.listLegacy();

  for (const record of legacy) {
    try {
      const existing = await input.repository.getScoped(scope, record.collection, record.id);
      if (existing) {
        if (!await contentEqual(existing.value, record.value)) {
          const failure = { state: "MIGRATION_FAILED", collection: record.collection, id: record.id, reason: "CONFLICT" } as const;
          input.onState?.(failure);
          return failure;
        }
        continue;
      }
      await input.repository.putScoped(scope, record);
    } catch {
      const failure = { state: "MIGRATION_FAILED", collection: record.collection, id: record.id, reason: "COPY_FAILED" } as const;
      input.onState?.(failure);
      return failure;
    }
  }

  input.onState?.("MIGRATION_VERIFYING");
  for (const collection of ["flights", "journal", "balloons", "documents", "preferences"] as const) {
    const expected = legacy.filter((record) => record.collection === collection);
    const scoped = await input.repository.listScoped(scope, collection);
    for (const record of expected) {
      const copied = scoped.find(({ id }) => id === record.id);
      if (!copied || !await contentEqual(copied.value, record.value)) {
        const failure = { state: "MIGRATION_FAILED", collection, id: record.id, reason: "VERIFY_FAILED" } as const;
        input.onState?.(failure);
        return failure;
      }
    }
  }

  input.repository.markComplete({ userId: input.userId, deviceId: input.deviceId, completedAt: (input.now ?? (() => new Date().toISOString()))() });
  input.onState?.("MIGRATION_COMPLETE");
  return "MIGRATION_COMPLETE";
}

export const LEGACY_MIGRATION_COMPLETIONS_KEY = "balloon-companion-auth-legacy-migration-completions-v1";
const SCOPED_DATABASE_NAME = "balloon-companion-scoped-local-data-v1";
const SCOPED_STORE = "records";
const PREFERENCE_KEYS = [FLIGHT_COMPLETION_STORAGE_KEY, "balloon-companion-balloons", "balloon-companion-pilot-profile", "balloon-companion-favorite-launch-sites-v1"] as const;

type ScopedRecord = MigrationRecord & Readonly<{ scope: `USER:${string}` }>;

function parseArrayRecords(raw: string | null, property: string, collection: MigrationCollection): MigrationRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const items = Array.isArray(value?.[property]) ? value[property] as Array<Record<string, unknown>> : [];
    return items.filter(({ id }) => typeof id === "string").map((item) => ({ collection, id: item.id as string, value: item }));
  } catch { return []; }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

function readAll(database: IDBDatabase, storeName: string): Promise<unknown[]> {
  return requestValue(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

function readOne(database: IDBDatabase, storeName: string, id: string): Promise<unknown> {
  return requestValue(database.transaction(storeName, "readonly").objectStore(storeName).get(id));
}

async function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  if (typeof factory.databases !== "function") return null;
  const names = await factory.databases();
  if (!names.some((database) => database.name === name)) return null;
  return requestValue(factory.open(name));
}

export class BrowserLocalDataMigrationRepository implements LocalDataMigrationRepository {
  private scopedDatabase: Promise<IDBDatabase> | null = null;
  private readonly storage: KeyValueStorage;
  private readonly factory: IDBFactory;

  constructor(storage: KeyValueStorage, factory: IDBFactory) {
    this.storage = storage;
    this.factory = factory;
  }

  private database(): Promise<IDBDatabase> {
    this.scopedDatabase ??= new Promise((resolve, reject) => {
      const request = this.factory.open(SCOPED_DATABASE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(SCOPED_STORE, { keyPath: ["scope", "collection", "id"] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.scopedDatabase;
  }

  private runtimeDatabase(scope: `USER:${string}`, collection: "flights" | "documents"): Promise<IDBDatabase> {
    const name = scopedIndexedDbName(scope, collection === "flights" ? RECORDED_FLIGHT_DB_NAME : BALLOON_DOCUMENT_DB_NAME);
    return new Promise((resolve, reject) => {
      const request = this.factory.open(name, 1);
      request.onupgradeneeded = () => {
        if (collection === "flights") {
          if (!request.result.objectStoreNames.contains(RECORDED_FLIGHTS_STORE)) request.result.createObjectStore(RECORDED_FLIGHTS_STORE, { keyPath: "id" });
          if (!request.result.objectStoreNames.contains("activeFlight")) request.result.createObjectStore("activeFlight", { keyPath: "key" });
        } else {
          if (!request.result.objectStoreNames.contains(BALLOON_DOCUMENTS_STORE)) request.result.createObjectStore(BALLOON_DOCUMENTS_STORE, { keyPath: "id" }).createIndex("balloonId", "balloonId", { unique: false });
          if (!request.result.objectStoreNames.contains(BALLOON_DOCUMENT_FILES_STORE)) request.result.createObjectStore(BALLOON_DOCUMENT_FILES_STORE, { keyPath: "documentId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async listLegacy(): Promise<readonly MigrationRecord[]> {
    const journal = parseArrayRecords(this.storage.getItem(FLIGHT_COMPLETION_STORAGE_KEY), "journalFlights", "journal");
    const balloons = parseArrayRecords(this.storage.getItem("balloon-companion-balloons"), "balloons", "balloons");
    const preferences = PREFERENCE_KEYS.flatMap((id) => {
      const value = this.storage.getItem(id);
      return value === null ? [] : [{ collection: "preferences", id, value } satisfies MigrationRecord];
    });
    const flightsDatabase = await openExisting(this.factory, RECORDED_FLIGHT_DB_NAME);
    const flights = flightsDatabase && flightsDatabase.objectStoreNames.contains(RECORDED_FLIGHTS_STORE)
      ? (await readAll(flightsDatabase, RECORDED_FLIGHTS_STORE)).filter((value): value is { id: string } => Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string")).map((value) => ({ collection: "flights", id: value.id, value } satisfies MigrationRecord))
      : [];
    flightsDatabase?.close();
    const documentsDatabase = await openExisting(this.factory, BALLOON_DOCUMENT_DB_NAME);
    let documents: MigrationRecord[] = [];
    if (documentsDatabase?.objectStoreNames.contains(BALLOON_DOCUMENTS_STORE) && documentsDatabase.objectStoreNames.contains(BALLOON_DOCUMENT_FILES_STORE)) {
      const metadata = (await readAll(documentsDatabase, BALLOON_DOCUMENTS_STORE)).filter((value): value is { id: string } => Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"));
      documents = await Promise.all(metadata.map(async (document) => ({
        collection: "documents",
        id: document.id,
        value: { metadata: document, file: await readOne(documentsDatabase, BALLOON_DOCUMENT_FILES_STORE, document.id) },
      })));
    }
    documentsDatabase?.close();
    return [...flights, ...journal, ...balloons, ...documents, ...preferences];
  }

  async getScoped(scope: `USER:${string}`, collection: MigrationCollection, id: string): Promise<MigrationRecord | null> {
    if (collection === "preferences") {
      const value = this.storage.getItem(scopedBusinessStorageKey(scope, id));
      return value === null ? null : { collection, id, value };
    }
    if (collection === "flights") {
      const database = await this.runtimeDatabase(scope, collection);
      const value = await requestValue(database.transaction(RECORDED_FLIGHTS_STORE, "readonly").objectStore(RECORDED_FLIGHTS_STORE).get(id));
      database.close();
      return value ? { collection, id, value } : null;
    }
    if (collection === "documents") {
      const database = await this.runtimeDatabase(scope, collection);
      const metadata = await requestValue(database.transaction(BALLOON_DOCUMENTS_STORE, "readonly").objectStore(BALLOON_DOCUMENTS_STORE).get(id));
      const file = metadata ? await requestValue(database.transaction(BALLOON_DOCUMENT_FILES_STORE, "readonly").objectStore(BALLOON_DOCUMENT_FILES_STORE).get(id)) : undefined;
      database.close();
      return metadata ? { collection, id, value: { metadata, file } } : null;
    }
    const database = await this.database();
    const value = await requestValue(database.transaction(SCOPED_STORE, "readonly").objectStore(SCOPED_STORE).get([scope, collection, id])) as ScopedRecord | undefined;
    return value ? { collection: value.collection, id: value.id, value: value.value } : null;
  }

  async putScoped(scope: `USER:${string}`, record: MigrationRecord): Promise<void> {
    if (record.collection === "preferences") {
      this.storage.setItem(scopedBusinessStorageKey(scope, record.id), String(record.value));
      return;
    }
    if (record.collection === "flights") {
      const database = await this.runtimeDatabase(scope, record.collection);
      const transaction = database.transaction(RECORDED_FLIGHTS_STORE, "readwrite");
      transaction.objectStore(RECORDED_FLIGHTS_STORE).add(record.value);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      database.close();
      return;
    }
    if (record.collection === "documents") {
      const value = record.value as { metadata: unknown; file: unknown };
      const database = await this.runtimeDatabase(scope, record.collection);
      const transaction = database.transaction([BALLOON_DOCUMENTS_STORE, BALLOON_DOCUMENT_FILES_STORE], "readwrite");
      transaction.objectStore(BALLOON_DOCUMENTS_STORE).add(value.metadata);
      if (value.file) transaction.objectStore(BALLOON_DOCUMENT_FILES_STORE).add(value.file);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      database.close();
      return;
    }
    const database = await this.database();
    const transaction = database.transaction(SCOPED_STORE, "readwrite");
    transaction.objectStore(SCOPED_STORE).add({ scope, ...record } satisfies ScopedRecord);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  }

  async listScoped(scope: `USER:${string}`, collection: MigrationCollection): Promise<readonly MigrationRecord[]> {
    if (collection === "preferences") return PREFERENCE_KEYS.flatMap((id) => { const value = this.storage.getItem(scopedBusinessStorageKey(scope, id)); return value === null ? [] : [{ collection, id, value }]; });
    if (collection === "flights") {
      const database = await this.runtimeDatabase(scope, collection);
      const values = await readAll(database, RECORDED_FLIGHTS_STORE);
      database.close();
      return values.filter((value): value is { id: string } => Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string")).map((value) => ({ collection, id: value.id, value }));
    }
    if (collection === "documents") {
      const database = await this.runtimeDatabase(scope, collection);
      const metadata = (await readAll(database, BALLOON_DOCUMENTS_STORE)).filter((value): value is { id: string } => Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"));
      const values = await Promise.all(metadata.map(async (document) => ({ collection, id: document.id, value: { metadata: document, file: await readOne(database, BALLOON_DOCUMENT_FILES_STORE, document.id) } })));
      database.close();
      return values;
    }
    const database = await this.database();
    const values = await requestValue(database.transaction(SCOPED_STORE, "readonly").objectStore(SCOPED_STORE).getAll()) as ScopedRecord[];
    return values.filter((record) => record.scope === scope && record.collection === collection).map(({ id, value }) => ({ collection, id, value }));
  }

  markComplete(input: Readonly<{ userId: string; deviceId: string; completedAt: string }>): void {
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(this.storage.getItem(LEGACY_MIGRATION_COMPLETIONS_KEY) ?? "{}"); } catch {}
    this.storage.setItem(LEGACY_MIGRATION_COMPLETIONS_KEY, JSON.stringify({ ...current, [`${input.userId}:${input.deviceId}`]: input }));
  }
}

export function hasCompletedLegacyMigration(storage: KeyValueStorage, userId: string, deviceId: string): boolean {
  try {
    const value = JSON.parse(storage.getItem(LEGACY_MIGRATION_COMPLETIONS_KEY) ?? "{}");
    const marker = value?.[`${userId}:${deviceId}`];
    return marker?.userId === userId && marker?.deviceId === deviceId && typeof marker?.completedAt === "string";
  } catch { return false; }
}
