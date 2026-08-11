import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE } from "../balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "../flightCompletionStorage.ts";
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from "../recordedFlightStorage.ts";
import type { KeyValueStorage } from "./deviceIdentity.ts";
import type { AuthSnapshot } from "./types.ts";

export type LocalDataScope = "GUEST" | `USER:${string}`;

export type LegacyLocalDataSummary = Readonly<{
  flights: number;
  journalEntries: number;
  balloons: number;
  documents: number;
  otherBusinessStorages: number;
}>;

export type PendingLocalDataMigration = Readonly<{
  state: "PENDING_LOCAL_DATA_MIGRATION";
  userId: string;
  deviceId: string;
  legacyDataSummary: LegacyLocalDataSummary;
}>;

const BALLOON_STORAGE_KEY = "balloon-companion-balloons";
const OTHER_BUSINESS_STORAGE_KEYS = Object.freeze([
  "balloon-companion-pilot-profile",
  "balloon-companion-favorite-launch-sites-v1",
]);

function arrayLength(raw: string | null, property: string): number {
  if (!raw) return 0;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return 0;
    const items = (value as Record<string, unknown>)[property];
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

export function getCurrentDataScope(snapshot: AuthSnapshot): LocalDataScope {
  if (snapshot.state === "SIGNED_OUT") return "GUEST";
  if ((snapshot.state === "SIGNED_IN" || snapshot.state === "OFFLINE_SESSION") && snapshot.user?.id) {
    return `USER:${snapshot.user.id}`;
  }
  throw new Error("Le scope local est indisponible tant que l’état Auth n’est pas résolu.");
}

type LegacyDataSources = Readonly<{
  storage: KeyValueStorage;
  countFlights(): Promise<number>;
  countDocuments(): Promise<number>;
}>;

export async function summarizeLegacyLocalData(sources: LegacyDataSources): Promise<LegacyLocalDataSummary> {
  return {
    flights: await sources.countFlights(),
    journalEntries: arrayLength(sources.storage.getItem(FLIGHT_COMPLETION_STORAGE_KEY), "journalFlights"),
    balloons: arrayLength(sources.storage.getItem(BALLOON_STORAGE_KEY), "balloons"),
    documents: await sources.countDocuments(),
    otherBusinessStorages: OTHER_BUSINESS_STORAGE_KEYS.filter((key) => sources.storage.getItem(key) !== null).length,
  };
}

export function hasLegacyLocalData(summary: LegacyLocalDataSummary): boolean {
  return Object.values(summary).some((count) => count > 0);
}

export function createPendingLocalDataMigration(input: Readonly<{
  snapshot: AuthSnapshot;
  deviceId: string;
  legacyDataSummary: LegacyLocalDataSummary;
}>): PendingLocalDataMigration | null {
  if (input.snapshot.state !== "SIGNED_IN" || !input.snapshot.user || !hasLegacyLocalData(input.legacyDataSummary)) return null;
  return {
    state: "PENDING_LOCAL_DATA_MIGRATION",
    userId: input.snapshot.user.id,
    deviceId: input.deviceId,
    legacyDataSummary: input.legacyDataSummary,
  };
}

async function existingDatabaseNames(factory: IDBFactory): Promise<Set<string>> {
  if (typeof factory.databases !== "function") return new Set();
  const databases = await factory.databases();
  return new Set(databases.map(({ name }) => name).filter((name): name is string => typeof name === "string"));
}

async function countExistingStore(factory: IDBFactory, existing: Set<string>, databaseName: string, storeName: string): Promise<number> {
  if (!existing.has(databaseName)) return 0;
  return new Promise((resolve) => {
    const request = factory.open(databaseName);
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) { database.close(); resolve(0); return; }
      const transaction = database.transaction(storeName, "readonly");
      const count = transaction.objectStore(storeName).count();
      count.onsuccess = () => { database.close(); resolve(count.result); };
      count.onerror = () => { database.close(); resolve(0); };
    };
  });
}

export async function inspectLegacyLocalData(storage: KeyValueStorage, factory: IDBFactory | undefined): Promise<LegacyLocalDataSummary> {
  const existing = factory ? await existingDatabaseNames(factory) : new Set<string>();
  return summarizeLegacyLocalData({
    storage,
    countFlights: () => factory ? countExistingStore(factory, existing, RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE) : Promise.resolve(0),
    countDocuments: () => factory ? countExistingStore(factory, existing, BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE) : Promise.resolve(0),
  });
}
