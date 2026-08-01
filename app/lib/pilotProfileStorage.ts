import { createEmptyPilotProfile, normalizePilotProfile, type PilotProfile } from "./pilotProfile.ts";
const STORAGE_KEY = "balloon-companion-pilot-profile";
export const PILOT_PROFILE_EVENT = "balloon-companion:pilot-profile-changed";
export function loadPilotProfile(): PilotProfile { if (typeof window === "undefined") return createEmptyPilotProfile(); try { return normalizePilotProfile(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")); } catch { return createEmptyPilotProfile(); } }
export function savePilotProfile(profile: PilotProfile): PilotProfile { const normalized = normalizePilotProfile(profile); if (typeof window !== "undefined") { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); window.dispatchEvent(new Event(PILOT_PROFILE_EVENT)); } return normalized; }
