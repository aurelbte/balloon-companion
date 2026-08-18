import { createEmptyPilotProfile, normalizePilotProfile, type PilotProfile } from "./pilotProfile.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";
import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
export const PILOT_PROFILE_STORAGE_KEY = "balloon-companion-pilot-profile";
export const PILOT_PROFILE_EVENT = "balloon-companion:pilot-profile-changed";
export function loadPilotProfile(): PilotProfile { if (typeof window === "undefined") return createEmptyPilotProfile(); try { return normalizePilotProfile(JSON.parse(readScopedBusinessValue(window.localStorage, PILOT_PROFILE_STORAGE_KEY) ?? "null")); } catch { return createEmptyPilotProfile(); } }
export function savePilotProfile(profile: PilotProfile): PilotProfile { const normalized = normalizePilotProfile(profile); if (typeof window !== "undefined" && writeScopedBusinessValue(window.localStorage, PILOT_PROFILE_STORAGE_KEY, JSON.stringify(normalized))) { enqueueLocalSyncMutation("pilot-profile", "singleton"); window.dispatchEvent(new Event(PILOT_PROFILE_EVENT)); } return normalized; }
