import { invalidateCloudSyncVerdict, CLOUD_SYNC_BUSINESS_STORAGE_KEYS } from "../cloudSyncVerdict.ts";
import { getCurrentDataScope, type LocalDataScope } from "./dataScope.ts";
import type { AuthSnapshot } from "./types.ts";

export const DATA_SCOPE_CHANGED_EVENT = "balloon-companion:data-scope-changed";
const USER_STORAGE_PREFIX = "balloon-companion-user-data-v1";
// Le namespace v1 a pu recevoir les anciens seeds métier avant l'isolation complète.
// Il reste physiquement intact mais ne doit jamais être importé dans un nouveau GUEST.
const GUEST_STORAGE_PREFIX = "balloon-companion-guest-data-v2";
let activeSnapshot: AuthSnapshot = { state: "UNKNOWN", user: null };
let guestModeActive = false;

export function setRuntimeAuthSnapshot(snapshot: AuthSnapshot): void { const previous = getRuntimeDataScope(); activeSnapshot = snapshot; if (previous !== getRuntimeDataScope()) invalidateCloudSyncVerdict(false, true); }
export function setRuntimeGuestModeActive(active: boolean): void { const previous = getRuntimeDataScope(); guestModeActive = active; if (previous !== getRuntimeDataScope()) invalidateCloudSyncVerdict(false, true); }
export function getRuntimeAuthState(): AuthSnapshot["state"] { return activeSnapshot.state; }
export function getRuntimeDataScope(): LocalDataScope | null { if (activeSnapshot.state === "UNKNOWN" || (activeSnapshot.state === "SIGNED_OUT" && !guestModeActive)) return null; return getCurrentDataScope(activeSnapshot); }
export function scopedBusinessStorageKey(scope: `USER:${string}`, legacyKey: string): string { return `${USER_STORAGE_PREFIX}:${encodeURIComponent(scope.slice(5))}:${legacyKey}`; }
export function guestBusinessStorageKey(legacyKey: string): string { return `${GUEST_STORAGE_PREFIX}:${legacyKey}`; }
export function scopedIndexedDbName(scope: LocalDataScope, legacyName: string): string { return scope === "GUEST" ? `${legacyName}:guest` : `${legacyName}:user:${encodeURIComponent(scope.slice(5))}`; }
export function readScopedBusinessValue(storage: Storage, legacyKey: string): string | null { const scope = getRuntimeDataScope(); return !scope ? null : storage.getItem(scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey)); }
export function writeScopedBusinessValue(storage: Storage, legacyKey: string, value: string): boolean { const scope = getRuntimeDataScope(); if (!scope) return false; const key = scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey);
  const rawPrevious = storage.getItem(key);
  if (rawPrevious?.includes("\"__balloonPendingSync\"")) {
    const previous = JSON.parse(rawPrevious);
    const next = JSON.parse(value);
    value = JSON.stringify({ ...next, __balloonPendingSync: previous.__balloonPendingSync });
  }
  storage.setItem(key, value); if (CLOUD_SYNC_BUSINESS_STORAGE_KEYS.has(legacyKey)) invalidateCloudSyncVerdict(); return true; }
export function removeScopedBusinessValue(storage: Storage, legacyKey: string): boolean { const scope = getRuntimeDataScope(); if (!scope) return false; storage.removeItem(scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey)); if (CLOUD_SYNC_BUSINESS_STORAGE_KEYS.has(legacyKey)) invalidateCloudSyncVerdict(); return true; }
