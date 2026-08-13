import { getCurrentDataScope, type LocalDataScope } from "./dataScope.ts";
import type { AuthSnapshot } from "./types.ts";

export const DATA_SCOPE_CHANGED_EVENT = "balloon-companion:data-scope-changed";
const USER_STORAGE_PREFIX = "balloon-companion-user-data-v1";
// Le namespace v1 a pu recevoir les anciens seeds métier avant l'isolation complète.
// Il reste physiquement intact mais ne doit jamais être importé dans un nouveau GUEST.
const GUEST_STORAGE_PREFIX = "balloon-companion-guest-data-v2";
let activeSnapshot: AuthSnapshot = { state: "UNKNOWN", user: null };
let guestModeActive = false;

export function setRuntimeAuthSnapshot(snapshot: AuthSnapshot): void { activeSnapshot = snapshot; }
export function setRuntimeGuestModeActive(active: boolean): void { guestModeActive = active; }
export function getRuntimeDataScope(): LocalDataScope | null { if (activeSnapshot.state === "UNKNOWN" || (activeSnapshot.state === "SIGNED_OUT" && !guestModeActive)) return null; return getCurrentDataScope(activeSnapshot); }
export function scopedBusinessStorageKey(scope: `USER:${string}`, legacyKey: string): string { return `${USER_STORAGE_PREFIX}:${encodeURIComponent(scope.slice(5))}:${legacyKey}`; }
export function guestBusinessStorageKey(legacyKey: string): string { return `${GUEST_STORAGE_PREFIX}:${legacyKey}`; }
export function scopedIndexedDbName(scope: LocalDataScope, legacyName: string): string { return scope === "GUEST" ? `${legacyName}:guest` : `${legacyName}:user:${encodeURIComponent(scope.slice(5))}`; }
export function readScopedBusinessValue(storage: Storage, legacyKey: string): string | null { const scope = getRuntimeDataScope(); return !scope ? null : storage.getItem(scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey)); }
export function writeScopedBusinessValue(storage: Storage, legacyKey: string, value: string): boolean { const scope = getRuntimeDataScope(); if (!scope) return false; storage.setItem(scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey), value); return true; }
export function removeScopedBusinessValue(storage: Storage, legacyKey: string): boolean { const scope = getRuntimeDataScope(); if (!scope) return false; storage.removeItem(scope === "GUEST" ? guestBusinessStorageKey(legacyKey) : scopedBusinessStorageKey(scope, legacyKey)); return true; }
