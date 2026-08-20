import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { createEmptyPilotProfile, normalizePilotProfile, type PilotProfile } from "./pilotProfile.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import {
  createEmptyQualificationProfile,
  emptyLegacyQualificationDeadlines,
  legacyQualificationDeadlines,
  normalizeQualificationEvent,
  normalizeQualificationProfile,
  PILOT_QUALIFICATIONS_VERSION,
  type PilotQualificationsState,
} from "./pilotQualifications.ts";

export const PILOT_QUALIFICATIONS_STORAGE_KEY = "balloon-companion-pilot-qualifications-v1";

type StoredPilotQualifications = Pick<PilotQualificationsState, "version" | "profile" | "events">;
type QualificationStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): QualificationStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function loadLegacyProfile(storage: QualificationStorage): PilotProfile {
  try {
    return normalizePilotProfile(JSON.parse(readScopedBusinessValue(storage as Storage, PILOT_PROFILE_STORAGE_KEY) ?? "null"));
  } catch {
    return createEmptyPilotProfile();
  }
}

function normalizeStored(value: unknown): StoredPilotQualifications {
  const candidate = value && typeof value === "object" ? value as Partial<StoredPilotQualifications> : {};
  return {
    version: PILOT_QUALIFICATIONS_VERSION,
    profile: normalizeQualificationProfile(candidate.profile),
    events: Array.isArray(candidate.events)
      ? candidate.events.map(normalizeQualificationEvent).filter((event) => event !== null)
      : [],
  };
}

export function createEmptyPilotQualificationsState(): PilotQualificationsState {
  return {
    version: PILOT_QUALIFICATIONS_VERSION,
    profile: createEmptyQualificationProfile(),
    events: [],
    legacy: emptyLegacyQualificationDeadlines(),
  };
}

export function loadPilotQualifications(storage: QualificationStorage | null = browserStorage()): PilotQualificationsState {
  if (!storage) return createEmptyPilotQualificationsState();
  let stored = normalizeStored(null);
  try {
    stored = normalizeStored(JSON.parse(readScopedBusinessValue(storage as Storage, PILOT_QUALIFICATIONS_STORAGE_KEY) ?? "null"));
  } catch {}
  return { ...stored, legacy: legacyQualificationDeadlines(loadLegacyProfile(storage)) };
}

export function savePilotQualifications(
  state: Pick<PilotQualificationsState, "profile" | "events">,
  storage: QualificationStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const normalized = normalizeStored({ version: PILOT_QUALIFICATIONS_VERSION, ...state });
  return writeScopedBusinessValue(storage as Storage, PILOT_QUALIFICATIONS_STORAGE_KEY, JSON.stringify(normalized));
}
