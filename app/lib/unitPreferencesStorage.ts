import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { DEFAULT_UNIT_PREFERENCES, type UnitPreferences } from "./unitPreferences.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";

export const UNIT_PREFERENCES_STORAGE_KEY = "balloon-companion-unit-preferences-v1";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeUnitPreferences(value: unknown): UnitPreferences {
  const candidate = value && typeof value === "object" ? value as Partial<UnitPreferences> : {};
  return {
    weather: {
      windSpeedUnit: oneOf(candidate.weather?.windSpeedUnit, ["km/h", "kt"], DEFAULT_UNIT_PREFERENCES.weather.windSpeedUnit),
      temperatureUnit: oneOf(candidate.weather?.temperatureUnit, ["°C", "°F"], DEFAULT_UNIT_PREFERENCES.weather.temperatureUnit),
    },
    flightInstruments: {
      speedUnit: oneOf(candidate.flightInstruments?.speedUnit, ["km/h", "kt"], DEFAULT_UNIT_PREFERENCES.flightInstruments.speedUnit),
      altitudeUnit: oneOf(candidate.flightInstruments?.altitudeUnit, ["m", "ft"], DEFAULT_UNIT_PREFERENCES.flightInstruments.altitudeUnit),
      distanceUnit: oneOf(candidate.flightInstruments?.distanceUnit, ["km", "NM"], DEFAULT_UNIT_PREFERENCES.flightInstruments.distanceUnit),
    },
  };
}

export function loadUnitPreferences(): UnitPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_UNIT_PREFERENCES;
  const raw = readScopedBusinessValue(localStorage, UNIT_PREFERENCES_STORAGE_KEY);
  if (!raw) return DEFAULT_UNIT_PREFERENCES;
  try { return normalizeUnitPreferences(JSON.parse(raw)); } catch { return DEFAULT_UNIT_PREFERENCES; }
}

export function saveUnitPreferences(value: UnitPreferences): boolean {
  if (typeof localStorage === "undefined") return false;
  const saved = writeScopedBusinessValue(localStorage, UNIT_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeUnitPreferences(value)));
  if (saved) enqueueLocalSyncMutation("unit-preferences", "singleton");
  return saved;
}
