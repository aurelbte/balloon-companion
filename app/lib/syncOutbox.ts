import { hasLocalStorageSyncIntent, recoverLocalStorageSyncIntents } from "./durableSyncIntent.ts";
import { getRuntimeDataScope, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import type { LocalDataScope } from "./auth/dataScope.ts";
import { createInitialSyncMetadata, type SyncMetadata } from "./syncMetadata.ts";

export const SYNC_OUTBOX_DB_NAME = "balloon-companion-sync-v1";
export const SYNC_MUTATIONS_STORE = "mutations";
export const SYNC_METADATA_STORE = "metadata";
export const SYNC_MUTATION_ENQUEUED_EVENT = "balloon-companion:sync-mutation-enqueued";

export type SyncOperation = "UPSERT" | "DELETE";
export type SyncMutationPayload = Readonly<{
  serverEntityType: string;
  serverEntityId: string;
  payload: Readonly<Record<string, unknown>>;
}>;
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
  /** Captured once before transport; retries of this mutationId reuse these bytes. */
  payloadSnapshot?: SyncMutationPayload;
  durableIntentIds?: readonly string[];
}>;

export type StoredSyncMetadata = SyncMetadata & Readonly<{
  /** Local receipts also deduplicate recovery after acknowledgement / another tab. */
  acknowledgedLocalIntentIds?: readonly string[];
  entityType: string;
  entityId: string;
}>;

export interface SyncOutboxStorage {
  getScope?(): LocalDataScope | null;
  enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number; mutationId?: string }>): Promise<SyncMutation>;
  enqueueFresh(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision: number }>): Promise<SyncMutation>;
  list(): Promise<SyncMutation[]>;
  getMetadata(entityType: string, entityId: string): Promise<StoredSyncMetadata | null>;
  listMetadata(): Promise<StoredSyncMetadata[]>;
  setMetadata(metadata: StoredSyncMetadata): Promise<void>;
  markAttempt(mutationId: string, input?: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }>): Promise<SyncMutation | null>;
  freezePayload(mutationId: string, payload: SyncMutationPayload): Promise<SyncMutation | null>;
  acknowledge(mutationId: string, metadata: StoredSyncMetadata): Promise<void>;
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

function sameEntity(left: SyncMutation, right: SyncMutation): boolean {
  return left.entityType === right.entityType && left.entityId === right.entityId;
}

function acknowledgedMetadata(metadata: StoredSyncMetadata, previous: StoredSyncMetadata | null, hasSuccessor: boolean, intentIds: readonly string[] = []): StoredSyncMetadata {
  const receipts = [...new Set([...(previous?.acknowledgedLocalIntentIds ?? []), ...intentIds])];
  if (receipts.length) metadata = { ...metadata, acknowledgedLocalIntentIds: receipts };
  if (!hasSuccessor || !previous) return metadata;
  // The server revision advances, but pending local edits own the local date/tombstone.
  return { ...metadata, updatedAt: previous.updatedAt, deletedAt: previous.deletedAt };
}

export class MemorySyncOutboxStorage implements SyncOutboxStorage {
  private readonly scope = getRuntimeDataScope();
  getScope(): LocalDataScope | null { return this.scope; }
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

  async enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number; mutationId?: string }>): Promise<SyncMutation> {
    const now = (this.dependencies.now ?? (() => new Date().toISOString()))();
    const baseRevision = input.baseRevision ?? this.metadata.get(metadataKey(input.entityType, input.entityId))?.revision ?? 0;
    // No await between reading candidates and writing: same atomic boundary as IDB.
    const replay = input.mutationId && [...this.mutations.values()].find((item) => item.mutationId === input.mutationId || item.durableIntentIds?.includes(input.mutationId!));
    if (replay) return replay;
    const previousReceipt = this.metadata.get(metadataKey(input.entityType, input.entityId));
    if (input.mutationId && previousReceipt?.acknowledgedLocalIntentIds?.includes(input.mutationId)) {
      return { ...input, mutationId: input.mutationId, baseRevision, createdAt: previousReceipt.updatedAt, attempts: 1 };
    }
    const merged = coalesce([...this.mutations.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), { ...input, baseRevision });
    let mutation = merged ?? {
      mutationId: input.mutationId ?? (this.dependencies.createId ?? mutationId)(),
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseRevision,
      createdAt: now,
      attempts: 0,
    };
    if (input.mutationId) mutation = { ...mutation, durableIntentIds: [...(mutation.durableIntentIds ?? []), input.mutationId] };
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

  async enqueueFresh(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision: number }>): Promise<SyncMutation> {
    const now = (this.dependencies.now ?? (() => new Date().toISOString()))();
    const mutation = { mutationId: (this.dependencies.createId ?? mutationId)(), ...input, createdAt: now, attempts: 0 };
    this.mutations.set(mutation.mutationId, mutation);
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
    const key = metadataKey(metadata.entityType, metadata.entityId);
    const receipts = this.metadata.get(key)?.acknowledgedLocalIntentIds;
    this.metadata.set(key, { ...metadata, ...(receipts ? { acknowledgedLocalIntentIds: receipts } : {}) });
  }

  async markAttempt(mutationIdValue: string, input: Readonly<{ nextAttemptAt?: string; lastErrorCode?: string }> = {}): Promise<SyncMutation | null> {
    const current = this.mutations.get(mutationIdValue);
    if (!current) return null;
    const updated = { ...current, attempts: current.attempts + 1, ...input };
    this.mutations.set(mutationIdValue, updated);
    return updated;
  }

  async freezePayload(mutationIdValue: string, payload: SyncMutationPayload): Promise<SyncMutation | null> {
    const current = this.mutations.get(mutationIdValue);
    if (!current) return null;
    if (current.attempts === 0) throw new Error("Mutation must be reserved before payload capture");
    const updated = current.payloadSnapshot ? current : { ...current, payloadSnapshot: structuredClone(payload) };
    this.mutations.set(mutationIdValue, updated);
    return structuredClone(updated);
  }

  async acknowledge(mutationIdValue: string, metadata: StoredSyncMetadata): Promise<void> {
    const current = this.mutations.get(mutationIdValue);
    if (!current) return;
    const successors = [...this.mutations.values()].filter((mutation) => mutation.mutationId !== mutationIdValue && sameEntity(mutation, current));
    for (const mutation of successors) {
      if (mutation.attempts === 0 && mutation.baseRevision === current.baseRevision) {
        this.mutations.set(mutation.mutationId, { ...mutation, baseRevision: metadata.revision });
      }
    }
    const key = metadataKey(current.entityType, current.entityId);
    this.metadata.set(key, acknowledgedMetadata(metadata, this.metadata.get(key) ?? null, successors.length > 0, current.durableIntentIds));
    this.mutations.delete(mutationIdValue);
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

  getScope(): LocalDataScope | null { return this.scope; }

  private database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponible"));
    this.scope ??= getRuntimeDataScope();
    if (!this.scope) return Promise.reject(new Error("Scope local indisponible"));
    this.databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(scopedIndexedDbName(this.scope!, SYNC_OUTBOX_DB_NAME), 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SYNC_MUTATIONS_STORE)) request.result.createObjectStore(SYNC_MUTATIONS_STORE, { keyPath: "mutationId" });
        if (!request.result.objectStoreNames.contains(SYNC_METADATA_STORE)) request.result.createObjectStore(SYNC_METADATA_STORE, { keyPath: ["entityType", "entityId"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error: unknown) => { this.databasePromise = null; throw error; });
    return this.databasePromise;
  }

  async enqueue(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision?: number; mutationId?: string }>): Promise<SyncMutation> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([SYNC_MUTATIONS_STORE, SYNC_METADATA_STORE], "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
      const mutationsRequest = store.getAll();
      const metadataRequest = metadataStore.get([input.entityType, input.entityId]);
      let reads = 2;
      let mutation: SyncMutation;
      const write = () => {
        if (--reads !== 0) return;
        const previous = metadataRequest.result as StoredSyncMetadata | undefined;
        const now = new Date().toISOString();
        const baseRevision = input.baseRevision ?? previous?.revision ?? 0;
        const replay = input.mutationId && (mutationsRequest.result as SyncMutation[]).find((item) => item.mutationId === input.mutationId || item.durableIntentIds?.includes(input.mutationId!));
        if (replay) { mutation = replay; return; }
        if (input.mutationId && previous?.acknowledgedLocalIntentIds?.includes(input.mutationId)) {
          mutation = { ...input, mutationId: input.mutationId, baseRevision, createdAt: previous.updatedAt, attempts: 1 }; return;
        }
        const candidates = (mutationsRequest.result as SyncMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        mutation = coalesce(candidates, { ...input, baseRevision }) ?? {
          mutationId: input.mutationId ?? mutationId(), entityType: input.entityType, entityId: input.entityId,
          operation: input.operation, baseRevision, createdAt: now, attempts: 0,
        };
        if (input.mutationId) mutation = { ...mutation, durableIntentIds: [...(mutation.durableIntentIds ?? []), input.mutationId] };
        store.put(mutation);
        metadataStore.put({
          entityType: input.entityType, entityId: input.entityId,
          ...(previous ?? createInitialSyncMetadata(now)), updatedAt: now,
          deletedAt: input.operation === "DELETE" ? now : undefined,
        });
      };
      mutationsRequest.onsuccess = write;
      metadataRequest.onsuccess = write;
      transaction.oncomplete = () => resolve(mutation);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async enqueueFresh(input: Readonly<{ entityType: string; entityId: string; operation: SyncOperation; baseRevision: number }>): Promise<SyncMutation> {
    const database = await this.database();
    const mutation = { mutationId: mutationId(), ...input, createdAt: new Date().toISOString(), attempts: 0 };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      transaction.objectStore(SYNC_MUTATIONS_STORE).add(mutation);
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
      const store = transaction.objectStore(SYNC_METADATA_STORE);
      const request = store.get([metadata.entityType, metadata.entityId]);
      request.onsuccess = () => {
        const receipts = (request.result as StoredSyncMetadata | undefined)?.acknowledgedLocalIntentIds;
        store.put({ ...metadata, ...(receipts ? { acknowledgedLocalIntentIds: receipts } : {}) });
      };
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
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async freezePayload(mutationIdValue: string, payload: SyncMutationPayload): Promise<SyncMutation | null> {
    const snapshot = structuredClone(payload);
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SYNC_MUTATIONS_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      let updated: SyncMutation | null = null;
      const request = store.get(mutationIdValue);
      request.onsuccess = () => {
        const current = request.result as SyncMutation | undefined;
        if (!current) return;
        if (current.attempts === 0) { transaction.abort(); return; }
        updated = current.payloadSnapshot ? current : { ...current, payloadSnapshot: snapshot };
        store.put(updated);
      };
      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async acknowledge(mutationIdValue: string, metadata: StoredSyncMetadata): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([SYNC_MUTATIONS_STORE, SYNC_METADATA_STORE], "readwrite");
      const store = transaction.objectStore(SYNC_MUTATIONS_STORE);
      const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
      const mutationsRequest = store.getAll();
      const metadataRequest = metadataStore.get([metadata.entityType, metadata.entityId]);
      let reads = 2;
      const commit = () => {
        if (--reads !== 0) return;
        const mutations = mutationsRequest.result as SyncMutation[];
        const current = mutations.find((mutation) => mutation.mutationId === mutationIdValue);
        if (!current) return;
        const successors = mutations.filter((mutation) => mutation.mutationId !== mutationIdValue && sameEntity(mutation, current));
        for (const mutation of successors) {
          if (mutation.attempts === 0 && mutation.baseRevision === current.baseRevision) {
            store.put({ ...mutation, baseRevision: metadata.revision });
          }
        }
        metadataStore.put(acknowledgedMetadata(metadata, metadataRequest.result ?? null, successors.length > 0, current.durableIntentIds));
        store.delete(mutationIdValue);
      };
      mutationsRequest.onsuccess = commit;
      metadataRequest.onsuccess = commit;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
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

export function enqueueLocalSyncMutation(entityType: string, entityId: string, operation: SyncOperation = "UPSERT", scope: LocalDataScope | null = getRuntimeDataScope()): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !scope) {
    if (scope?.startsWith("USER:")) console.warn("[syncOutbox] Synchronisation différée : outbox indisponible, intention locale conservée");
    return Promise.resolve(false);
  }
  const storage = runtimeStorages.get(scope) ?? new IndexedDbSyncOutboxStorage(scope);
  runtimeStorages.set(scope, storage);
  let journaled = false;
  try {
    journaled = scope !== "GUEST" && typeof window !== "undefined" && hasLocalStorageSyncIntent(window.localStorage, scope, entityType, entityId);
  } catch (error) {
    console.warn("[syncOutbox] Intention locale inaccessible, synchronisation différée", error);
    return Promise.resolve(false);
  }
  const queued = enqueueChain.catch(() => undefined).then(async () => {
    const recovered = scope !== "GUEST" && typeof window !== "undefined" && await recoverLocalStorageSyncIntents(window.localStorage, scope, storage, { entityType, entityId });
    // Another recovery may already have transferred this write while we waited.
    if (!recovered && !journaled) await storage.enqueue({ entityType, entityId, operation });
    window.dispatchEvent(new Event(SYNC_MUTATION_ENQUEUED_EVENT));
    return true;
  }).catch((error: unknown) => {
    console.warn("[syncOutbox] Synchronisation différée, intention locale conservée", { entityType, entityId, operation, error });
    return false;
  });
  enqueueChain = queued;
  return queued;
}
