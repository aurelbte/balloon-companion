import {
  RECORDED_FLIGHT_SCHEMA_VERSION,
  type RecordedFlight,
} from "./recordedFlight.ts";

const DATABASE_NAME = "balloon-companion-flights";
const DATABASE_VERSION = 1;
const FLIGHTS_STORE = "flights";
const ACTIVE_FLIGHT_STORE = "activeFlight";
const ACTIVE_FLIGHT_KEY = "current";

interface ActiveFlightRecord {
  key: typeof ACTIVE_FLIGHT_KEY;
  flight: RecordedFlight;
}

export interface RecordedFlightStorage {
  getActiveFlight(): Promise<RecordedFlight | null>;
  saveActiveFlight(flight: RecordedFlight): Promise<void>;
  clearActiveFlight(): Promise<void>;
  completeFlight(flight: RecordedFlight): Promise<void>;
  getFlight(id: string): Promise<RecordedFlight | null>;
  listFlights(): Promise<RecordedFlight[]>;
}

function isRecordedFlight(value: unknown): value is RecordedFlight {
  if (!value || typeof value !== "object") return false;
  const flight = value as Partial<RecordedFlight>;
  return (
    typeof flight.id === "string" &&
    flight.id.length > 0 &&
    flight.schemaVersion === RECORDED_FLIGHT_SCHEMA_VERSION &&
    ["RECORDING", "COMPLETED", "INTERRUPTED"].includes(flight.status ?? "") &&
    typeof flight.startedAt === "number" &&
    Number.isFinite(flight.startedAt) &&
    (flight.endedAt === null ||
      (typeof flight.endedAt === "number" && Number.isFinite(flight.endedAt))) &&
    Array.isArray(flight.points) &&
    Boolean(flight.summary) &&
    typeof flight.createdAt === "number" &&
    typeof flight.updatedAt === "number"
  );
}

export class MemoryRecordedFlightStorage implements RecordedFlightStorage {
  private activeFlight: RecordedFlight | null = null;
  private readonly flights = new Map<string, RecordedFlight>();

  async getActiveFlight() {
    return this.activeFlight;
  }
  async saveActiveFlight(flight: RecordedFlight) {
    this.activeFlight = structuredClone(flight);
  }
  async clearActiveFlight() {
    this.activeFlight = null;
  }
  async completeFlight(flight: RecordedFlight) {
    this.flights.set(flight.id, structuredClone(flight));
    this.activeFlight = null;
  }
  async getFlight(id: string) {
    return this.flights.get(id) ?? null;
  }
  async listFlights() {
    return [...this.flights.values()].sort(
      (left, right) => right.startedAt - left.startedAt,
    );
  }
}

export class IndexedDbRecordedFlightStorage implements RecordedFlightStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB indisponible"));
    }
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FLIGHTS_STORE)) {
          request.result.createObjectStore(FLIGHTS_STORE, { keyPath: "id" });
        }
        if (!request.result.objectStoreNames.contains(ACTIVE_FLIGHT_STORE)) {
          request.result.createObjectStore(ACTIVE_FLIGHT_STORE, {
            keyPath: "key",
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }

  async getActiveFlight(): Promise<RecordedFlight | null> {
    const database = await this.database();
    const record = await new Promise<ActiveFlightRecord | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(ACTIVE_FLIGHT_STORE)
          .objectStore(ACTIVE_FLIGHT_STORE)
          .get(ACTIVE_FLIGHT_KEY);
        request.onsuccess = () =>
          resolve(request.result as ActiveFlightRecord | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    return record && isRecordedFlight(record.flight) ? record.flight : null;
  }

  async saveActiveFlight(flight: RecordedFlight): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ACTIVE_FLIGHT_STORE,
        "readwrite",
      );
      transaction
        .objectStore(ACTIVE_FLIGHT_STORE)
        .put({ key: ACTIVE_FLIGHT_KEY, flight } satisfies ActiveFlightRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async clearActiveFlight(): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ACTIVE_FLIGHT_STORE,
        "readwrite",
      );
      transaction.objectStore(ACTIVE_FLIGHT_STORE).delete(ACTIVE_FLIGHT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async completeFlight(flight: RecordedFlight): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [FLIGHTS_STORE, ACTIVE_FLIGHT_STORE],
        "readwrite",
      );
      transaction.objectStore(FLIGHTS_STORE).put(flight);
      transaction.objectStore(ACTIVE_FLIGHT_STORE).delete(ACTIVE_FLIGHT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getFlight(id: string): Promise<RecordedFlight | null> {
    const database = await this.database();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = database
        .transaction(FLIGHTS_STORE)
        .objectStore(FLIGHTS_STORE)
        .get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return isRecordedFlight(value) ? value : null;
  }

  async listFlights(): Promise<RecordedFlight[]> {
    const database = await this.database();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = database
        .transaction(FLIGHTS_STORE)
        .objectStore(FLIGHTS_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    return values
      .filter(isRecordedFlight)
      .sort((left, right) => right.startedAt - left.startedAt);
  }
}
