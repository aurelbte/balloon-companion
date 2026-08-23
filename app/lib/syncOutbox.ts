import { getRuntimeDataScope, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import type { LocalDataScope } from "./auth/dataScope.ts";
import { createInitialSyncMetadata, type SyncMetadata } from "./syncMetadata.ts";

export const SYNC_OUTBOX_DB_NAME = "balloon-companion-sync-v1";
export const SYNC_MUTATIONS_STORE = "mutations";
export const SYNC_METADATA_STORE = "metadata";
export const SYNC_MUTATION_ENQUEUED_EVENT = "balloon-companion:sync-mutation-enqueued";

export type SyncOperation = "UPSERT" | "DELETE";
export type SyncMutation = Readonly<{
  mutationId: string;
  entityType: string;
  entityId: string;
  operation: SyncOperation;
  baseRevision: number;
  createdAt: string;
  attempts: number;
  nextAttemptAt?: string;
  lastErrorCode?: string;
}>;

export type StoredSyncMetadata = SyncMetadata & Readonly<{
  entityType: string;
  entityId: string;
}>;

export interface SyncOutboxStorage {
  enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number }>): Promise<SyncMutation>;
  list(): Promise<SyncMutation[]>;
  getMetadata(entityType: string, entityId: string): Promise<StoredSyncMetadata | null>;
  listMetadata(): Promise<StoredSyncMetadata[]>;
  setMetadata(metadata: StoredSyncMetadata): Promise<void>;
  markAttempt(mutationId: string, input?: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }>): Promise<SyncMutation | null>;
  updateMutation(mutationId: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }>): Promise<SyncMutation | null>;
  remove(mutationId: string): Promise<void>;
  removeMany(mutationIds: readonly string[]): Promise<void>;
}

type SyncOutboxDependencies = Readonly<{
  createId?: () => string;
  now?: () => string;
}>;

function mutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("Secure sync mutation identity generation is unavailable");
}

function metadataKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`;
}

function coalesce(
  mutations: readonly SyncMutation[],
  input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision: number }>,
): SyncMutation | null {
  const existing = [...mutations].reverse().find((candidate) =>
    candidate.entityType === input.entityType && candidate.entityId === input.entityId && candidate.attempts === 0,
  );
  if (!existing) return null;
  if (existing.operation === "UPSERT" && (input.operation === "UPSERT" || input.operation === "DELETE")) {
    return { ...existing, operation: input.operation, baseRevision: Math.min(existing.baseRevision, input.baseRevision) };
  }
  if (existing.operation === "DELETE" && input.operation === "DELETE") return existing;
  return null;
}

export class MemorySyncOutboxStorage implements SyncOutboxStorage {
  private readonly mutations: Map<string, SyncMutation>;
  private readonly metadata: Map<string, StoredSyncMetadata>;
  private readonly dependencies: SyncOutboxDependencies;

  constructor(input: Readonly<{
    mutations?: Map<string, SyncMutation>;
    metadata?: Map<string, StoredSyncMetadata>;
    dependencies?: SyncOutboxDependencies;
  }> = {}) {
    this.mutations = input.mutations ?? new Map();
    this.metadata = input.metadata ?? new Map();
    this.dependencies = input.dependencies ?? {};
  }

  async enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number }>): Promise<SyncMutation> {
    const now = (this.dependencies.now ?? (() => new Date().toISOString()))();
    const baseRevision = input.baseRevision ?? this.metadata.get(metadataKey(input.entityType, input.entityId))?.revision ?? 0;
    const merged = coalesce(await this.list(), { ...input, baseRevision });
    const mutation = merged ?? {
      mutationId: (this.dependencies.createId ?? mutationId)(),
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseRevision,
      createdAt: now,
      attempts: 0,
    };
    this.mutations.set(mutation.mutationId, mutation);
    const previous = this.metadata.get(metadataKey(input.entityType, input.entityId));
    this.metadata.set(metadataKey(input.entityType, input.entityId), {
      entityType: input.entityType,
      entityId: input.entityId,
      ...(previous ?? createInitialSyncMetadata(now)),
      updatedAt: now,
      ...(input.operation === "DELETE" ? { deletedAt: now } : { deletedAt: undefined }),
    });
    return mutation;
  }

  async list(): Promise<SyncMutation[]> {
    return [...this.mutations.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getMetadata(entityType: string, entityId: string): Promise<StoredSyncMetadata | null> {
    return this.metadata.get(metadataKey(entityType, entityId)) ?? null;
  }
  async listMetadata(): Promise<StoredSyncMetadata[]> {
    return [...this.metadata.values()].sort((left, right) => left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId));
  }

  async setMetadata(metadata: StoredSyncMetadata): Promise<void> {
    this.metadata.set(metadataKey(metadata.entityType, metadata.entityId), metadata);
  }

  async markAttempt(mutationIdValue: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }> = {}): Promise<SyncMutation | null> {
    const current = this.mutations.get(mutationIdValue);
    if (!current) return null;
    const updated = { ...current, attempts: current.attempts + 1, ...input };
    this.mutations.set(mutationIdValue, updated);
    return updated;
  }

  async updateMutation(mutationIdValue: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }>): Promise<SyncMutation | null> {
    const current = this.mutations.get(mutationIdValue);
    if (!current) return null;
    const updated = { ...current, ...input };
    this.mutations.set(mutationIdValue, updated);
    return updated;
  }

  async remove(mutationIdValue: string): Promise<void> {
    this.mutations.delete(mutationIdValue);
  }
  async removeMany(mutationIds: readonly string[]): Promise<void> {
    for (const mutationIdValue of mutationIds) this.mutations.delete(mutationIdValue);
  }
}

export class IndexedDbSyncOutboxStorage implements SyncOutboxStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private scope: LocalDataScope | null = null;

  constructor(scope: LocalDataScope | null = null) {
    this.scope = scope;
  }

  private database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponible"));
    this.scope ??= getRuntimeDataScope();
    if (!this.scope) return Promise.reject(new Error("Scope local indisponible"));
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(scopedIndexedDbName(this.scope!, SYNC_OUTBOX_DB_NAME), 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SYNC_MUTATIONS_STORE)) request.result.createObjectStore(SYNC_MUTATIONS_STORE, { keyPath: "mutationId" });
        if (!request.result.objectStoreNames.contains(SYNC_METADATA_STORE)) request.result.createObjectStore(SYNC_METADATA_STORE, { keyPath: ["entityType", "entityId"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }

  async enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number }>): Promise<SyncMutation> {
    const database = await this.database();
    const existingMutations = await this.list();
    const previous = await this.getMetadata(input.entityType, input.entityId);
    const now = new Date().toISOString();
    const baseRevision = input.baseRevision ?? previous?.revision ?? 0;
    const merged = coalesce(existingMutations, { ...input, baseRevision });
    const mutation = merged ?? { mutationId: mutationId(), entityType: input.entityType, entityId: input.entityId, operation: input.operation, baseRevision, createdAt: now, attempts: 0 };
    const metadata: StoredSyncMetadata = {
      entityType: input.entityType,
      entityId: input.entityId,
      ...(previous ?? createInitialSyncMetadata(now)),
      updatedAt: now,
      ...(input.operation === "DELETE" ? { deletedAt: now } : { deletedAt: undefined }),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([SYNC_MUTATIONS_STORE, SYNC_METADATA_STORE], "readwrite");
      transaction.objectStore(SYNC_MUTATIONS_STORE).put(mutation);
      transaction.objectStore(SYNC_METADATA_STORE).put(metadata);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return mutation;
  }

  async list(): Promise<SyncMutation[]> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SYNC_MUTATIONS_STORE).objectStore(SYNC_MUTATIONS_STORE).getAll();
      request.onsuccess = () => resolve((request.result as SyncMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      request.onerror = () => reject(request.error);
    });
  }

  async getMetadata(entityType: string, entityId: string): Promise<StoredSyncMetadata | null> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SYNC_METADATA_STORE).objectStore(SYNC_METADATA_STORE).get([entityType, entityId]);
      request.onsuccess = () => resolve((request.result as StoredSyncMetadata | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }
  async listMetadata(): Promise<StoredSyncMetadata[]> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SYNC_METADATA_STORE).objectStore(SYNC_METADATA_STORE).getAll();
      request.onsuccess = () => resolve((request.result as StoredSyncMetadata[])
        .sort((left, right) => left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId)));
      request.onerror = () => reject(request.error);
    });
  }

  async setMetadata(metadata: StoredSyncMetadata): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SYNC_METADATA_STORE, "readwrite");
      transaction.objectStore(SYNC_METADATA_STORE).put(metadata);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async markAttempt(mutationIdValue: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }> = {}): Promise<SyncMutation | null> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      let updated: SyncMutation | null = null;
      const request = store.get(mutationIdValue);
      request.onsuccess = () => {
        const current = request.result as SyncMutation | undefined;
        if (!current) return;
        updated = { ...current, attempts: current.attempts + 1, ...input };
        store.put(updated);
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async updateMutation(mutationIdValue: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }>): Promise<SyncMutation | null> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      let updated: SyncMutation | null = null;
      const request = store.get(mutationIdValue);
      request.onsuccess = () => {
        const current = request.result as SyncMutation | undefined;
        if (!current) return;
        updated = { ...current, ...input };
        store.put(updated);
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async remove(mutationIdValue: string): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      transaction.objectStore(SYNC_MUTATIONS_STORE).delete(mutationIdValue);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async removeMany(mutationIds: readonly string[]): Promise<void> {
    if (mutationIds.length === 0) return;
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      for (const mutationIdValue of mutationIds) store.delete(mutationIdValue);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

const runtimeStorages = new Map<LocalDataScope, IndexedDbSyncOutboxStorage>();
let enqueueChain: Promise<unknown> = Promise.resolve();

export function enqueueLocalSyncMutation(entityType: string, entityId: string, operation: SyncOperation = "UPSERT"): Promise<boolean> {
  const scope = getRuntimeDataScope();
  if (typeof indexedDB === "undefined" || !scope) return Promise.resolve(false);
  const storage = runtimeStorages.get(scope) ?? new IndexedDbSyncOutboxStorage(scope);
  runtimeStorages.set(scope, storage);
  const queued = enqueueChain.catch(() => undefined).then(async () => {
    await storage.enqueue({ entityType, entityId, operation });
    window.dispatchEvent(new Event(SYNC_MUTATION_ENQUEUED_EVENT));
    return true;
  }).catch((error: unknown) => {
    if (process.env.NODE_ENV === "development") console.error("[syncOutbox] Mutation locale non enregistrée", { entityType, entityId, operation, error });
    return false;
  });
  enqueueChain = queued;
  return queued;
}
