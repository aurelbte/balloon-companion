import { createEmptyPilotProfile, normalizePilotProfile, type PilotProfile } from "./pilotProfile.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";
import { getRuntimeDataScope, readScopedBusinessValue, scopedBusinessStorageKey, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
export const PILOT_PROFILE_STORAGE_KEY = "balloon-companion-pilot-profile";
export const PILOT_PROFILE_EVENT = "balloon-companion:pilot-profile-changed";
export function loadPilotProfile(): PilotProfile { if (typeof window === "undefined") return createEmptyPilotProfile(); try { return normalizePilotProfile(JSON.parse(readScopedBusinessValue(window.localStorage, PILOT_PROFILE_STORAGE_KEY) ?? "null")); } catch { return createEmptyPilotProfile(); } }
export function savePilotProfile(profile: PilotProfile): PilotProfile { const normalized = normalizePilotProfile(profile); if (typeof window !== "undefined" && writeScopedBusinessValue(window.localStorage, PILOT_PROFILE_STORAGE_KEY, JSON.stringify(normalized))) { enqueueLocalSyncMutation("pilot-profile", "singleton"); window.dispatchEvent(new Event(PILOT_PROFILE_EVENT)); } return normalized; }

/** Pull-only profile hydration. It never enqueues a PUSH mutation. */
export function applyPilotProfileFromCloudWithoutEnqueue(
  scope: `USER:${string}`,
  profile: PilotProfile | null,
  storage: Storage = window.localStorage,
): boolean {
  if (typeof window === "undefined" || getRuntimeDataScope() !== scope) return false;
  const key = scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY);
  if (profile) storage.setItem(key, JSON.stringify(normalizePilotProfile(profile)));
  else storage.removeItem(key);
  window.dispatchEvent(new Event(PILOT_PROFILE_EVENT));
  return true;
}
