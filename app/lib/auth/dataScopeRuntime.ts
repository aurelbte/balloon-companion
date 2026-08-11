import { getCurrentDataScope, type LocalDataScope } from "./dataScope.ts";
import type { AuthSnapshot } from "./types.ts";

export const DATA_SCOPE_CHANGED_EVENT = "balloon-companion:data-scope-changed";
const USER_STORAGE_PREFIX = "balloon-companion-user-data-v1";
let activeSnapshot: AuthSnapshot = { state: "UNKNOWN", user: null };

export function setRuntimeAuthSnapshot(snapshot: AuthSnapshot): void { activeSnapshot = snapshot; }
export function getRuntimeDataScope(): LocalDataScope | null { return activeSnapshot.state === "UNKNOWN" ? null : getCurrentDataScope(activeSnapshot); }
export function scopedBusinessStorageKey(scope: `USER:${string}`, legacyKey: string): string { return `${USER_STORAGE_PREFIX}:${encodeURIComponent(scope.slice(5))}:${legacyKey}`; }
export function scopedIndexedDbName(scope: LocalDataScope, legacyName: string): string { return scope === "GUEST" ? legacyName : `${legacyName}:user:${encodeURIComponent(scope.slice(5))}`; }
export function readScopedBusinessValue(storage: Storage, legacyKey: string): string | null { const scope = getRuntimeDataScope(); return !scope ? null : storage.getItem(scope === "GUEST" ? legacyKey : scopedBusinessStorageKey(scope, legacyKey)); }
export function writeScopedBusinessValue(storage: Storage, legacyKey: string, value: string): boolean { const scope = getRuntimeDataScope(); if (!scope) return false; storage.setItem(scope === "GUEST" ? legacyKey : scopedBusinessStorageKey(scope, legacyKey), value); return true; }
