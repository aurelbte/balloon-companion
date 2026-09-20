import { invalidateCloudSyncVerdict, invalidateCloudSyncObservation } from "./cloudSyncVerdict.ts";
import { getRuntimeDataScope, scopedBusinessStorageKey, guestBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import type { LocalDataScope } from "./auth/dataScope.ts";
import type { SyncOperation, SyncOutboxStorage } from "./syncOutbox.ts";

// Stored with the business value, in the SAME setItem / IDB transaction.
export const LOCAL_SYNC_INTENTS = "__balloonPendingSync";
export const LOCAL_SYNC_DELETED = "__balloonDeleted";
export type LocalSyncIntent = Readonly<{ mutationId: string; entityType: string; entityId: string; operation: SyncOperation }>;
export type LocalSyncChange = Omit<LocalSyncIntent, "mutationId">;
type IntentRecord = Record<string, unknown>;
export function pendingSyncIntents(value: unknown): LocalSyncIntent[] {
  return value && typeof value === "object" ? ((value as IntentRecord)[LOCAL_SYNC_INTENTS] as LocalSyncIntent[] | undefined) ?? [] : [];
}
export function withSyncIntents<T extends object>(value: T, changes: readonly LocalSyncChange[], previous: unknown = value, scope: LocalDataScope | null = getRuntimeDataScope()): T {
  if (!scope?.startsWith("USER:")) return value;
  if (changes.length) invalidateCloudSyncVerdict();
  const intents = [...pendingSyncIntents(previous), ...changes.map((change) => ({ ...change, mutationId: crypto.randomUUID() }))];
  const next = { ...value, [LOCAL_SYNC_INTENTS]: intents };
  if (!intents.length) delete (next as Record<string, unknown>)[LOCAL_SYNC_INTENTS];
  return next;
}
export function isLocalSyncDeleted(value: unknown): boolean { return Boolean(value && typeof value === "object" && (value as IntentRecord)[LOCAL_SYNC_DELETED]); }
function withoutIntents(value: IntentRecord, ids: ReadonlySet<string>): IntentRecord {
  const next = { ...value }; const retained = pendingSyncIntents(value).filter((intent) => !ids.has(intent.mutationId));
  if (retained.length) next[LOCAL_SYNC_INTENTS] = retained; else delete next[LOCAL_SYNC_INTENTS];
  return next;
}
export function writeBusinessValueWithSync(storage: Storage, legacyKey: string, value: string, changes: readonly LocalSyncChange[]): boolean {
  const scope = getRuntimeDataScope(); if (!scope) return false;
  const key = scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey);
  const previous = JSON.parse(storage.getItem(key) ?? "null");
  storage.setItem(key, JSON.stringify(withSyncIntents(JSON.parse(value) as object, changes, previous, scope)));
  return true;
}
async function transfer(intents: readonly LocalSyncIntent[], outbox: SyncOutboxStorage, scope: LocalDataScope, active: () => boolean = () => true): Promise<Set<string>> {
  if (outbox.getScope?.() !== scope) throw new Error("SYNC_INTENT_SCOPE_MISMATCH");
  const transferred = new Set<string>();
  for (const intent of intents) {
    if (!active()) throw new Error("SYNC_INTENT_RECOVERY_TIMEOUT");
    if (getRuntimeDataScope() !== scope) throw new Error("SYNC_INTENT_USER_SWITCH");
    await outbox.enqueue(intent);
    if (!active()) throw new Error("SYNC_INTENT_RECOVERY_TIMEOUT");
    transferred.add(intent.mutationId);
  }
  return transferred;
}
export function hasLocalStorageSyncIntent(storage: Storage, scope: `USER:${string}`, entityType: string, entityId: string): boolean {
  const prefix = scopedBusinessStorageKey(scope, "");
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key); if (!raw?.includes(`"${LOCAL_SYNC_INTENTS}"`)) continue;
    if (pendingSyncIntents(JSON.parse(raw)).some((intent) => intent.entityType === entityType && intent.entityId === entityId)) return true;
  }
  return false;
}
async function recoverLocalStorageSyncIntentsUnlocked(storage: Storage, scope: `USER:${string}`, outbox: SyncOutboxStorage, only?: Readonly<{entityType: string; entityId: string}>, active: () => boolean = () => true): Promise<boolean> {
  const prefix = scopedBusinessStorageKey(scope, ""); let found = false;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) {
    const raw = storage.getItem(key); if (!raw?.includes(`"${LOCAL_SYNC_INTENTS}"`)) continue;
    const value = JSON.parse(raw) as IntentRecord;
    const intents = pendingSyncIntents(value).filter((intent) => !only || (intent.entityType === only.entityType && intent.entityId === only.entityId));
    if (!intents.length) continue; found = true;
    const transferred = await transfer(intents, outbox, scope, active);
    if (!active()) throw new Error("SYNC_INTENT_RECOVERY_TIMEOUT");
    if (getRuntimeDataScope() !== scope) throw new Error("SYNC_INTENT_USER_SWITCH");
    // Re-read: another local write may have occurred during the enqueue.
    const latest = JSON.parse(storage.getItem(key) ?? "null") as IntentRecord | null;
    if (latest) { storage.setItem(key, JSON.stringify(withoutIntents(latest, transferred))); invalidateCloudSyncVerdict(); }
  }
  return found;
}
async function recoverIndexedDbSyncIntentsUnlocked(database: IDBDatabase, storeName: string, scope: LocalDataScope, outbox: SyncOutboxStorage, active: () => boolean = () => true): Promise<void> {
  const values = await new Promise<IntentRecord[]>((resolve, reject) => {
    const pending: IntentRecord[] = [];
    const request = database.transaction(storeName).objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(pending); return; }
      const intents = pendingSyncIntents(cursor.value);
      // Do not retain full flight traces / document metadata during recovery.
      if (intents.length) pending.push({ id: cursor.value.id, [LOCAL_SYNC_INTENTS]: intents });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  for (const value of values) {
    if (!active()) throw new Error("SYNC_INTENT_RECOVERY_TIMEOUT");
    const intents = pendingSyncIntents(value); if (!intents.length) continue;
    const transferred = await transfer(intents, outbox, scope, active);
    if (!active()) throw new Error("SYNC_INTENT_RECOVERY_TIMEOUT");
    if (getRuntimeDataScope() !== scope) throw new Error("SYNC_INTENT_USER_SWITCH");
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(storeName, "readwrite"), store = tx.objectStore(storeName), request = store.get(value.id as IDBValidKey);
      request.onsuccess = () => {
        if (!request.result) return;
        const latest = withoutIntents(request.result, transferred);
        if (isLocalSyncDeleted(latest) && !pendingSyncIntents(latest).length) store.delete(value.id as IDBValidKey); else store.put(latest);
      };
      tx.oncomplete = () => { invalidateCloudSyncVerdict(); resolve(); }; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
}

let recoveryChain: Promise<unknown> = Promise.resolve();
const activeRecoveries = new Set<LocalDataScope>();
export function isLocalSyncRecoveryRunning(scope: LocalDataScope): boolean { return activeRecoveries.has(scope); }
function notifyRecoveryActivity(): void { invalidateCloudSyncObservation(); }
function serialize<T>(work: (active: () => boolean) => Promise<T>, scope: LocalDataScope, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let valid = true;
  const physical = recoveryChain.catch(() => undefined).then(async () => {
    activeRecoveries.add(scope); notifyRecoveryActivity();
    try { return await work(() => valid && !signal?.aborted); }
    finally { valid = false; activeRecoveries.delete(scope); notifyRecoveryActivity(); }
  });
  recoveryChain = physical.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const visible = Promise.race([
    physical,
    new Promise<never>((_, reject) => { timer = setTimeout(() => { valid = false; reject(new Error("SYNC_INTENT_RECOVERY_TIMEOUT")); }, timeoutMs); }),
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
    activeRecoveries.delete(scope);
    notifyRecoveryActivity();
  });
  return visible;
}
export function recoverLocalStorageSyncIntents(storage: Storage, scope: `USER:${string}`, outbox: SyncOutboxStorage, only?: Readonly<{entityType: string; entityId: string}>, timeoutMs = 30_000, signal?: AbortSignal): Promise<boolean> {
  return serialize((active) => recoverLocalStorageSyncIntentsUnlocked(storage, scope, outbox, only, active), scope, timeoutMs, signal);
}
export function recoverIndexedDbSyncIntents(database: IDBDatabase, storeName: string, scope: LocalDataScope, outbox: SyncOutboxStorage, timeoutMs = 30_000, signal?: AbortSignal): Promise<void> {
  return serialize((active) => recoverIndexedDbSyncIntentsUnlocked(database, storeName, scope, outbox, active), scope, timeoutMs, signal);
}
export function putIndexedDbWithSyncIntents<T extends { id: string }>(store: IDBObjectStore, value: T, changes: readonly LocalSyncChange[], scope: LocalDataScope): void {
  const request = store.get(value.id);
  request.onsuccess = () => store.put(withSyncIntents(value, changes, request.result, scope));
}
