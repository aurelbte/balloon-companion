import { readScopedBusinessValue, writeScopedBusinessValue } from "../auth/dataScopeRuntime.ts";
import { normalizeAirportIcao } from "./aviationWeather.ts";

export const AVIATION_PREFERENCES_STORAGE_KEY = "balloon-companion-aviation-preferences-v1";
export type AviationPreferences = { airportIcao: string | null; initialized: true };

export function loadAviationPreferences(): AviationPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(readScopedBusinessValue(window.localStorage, AVIATION_PREFERENCES_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || (value as { initialized?: unknown }).initialized !== true) return null;
    return { airportIcao: normalizeAirportIcao((value as { airportIcao?: string | null }).airportIcao) ?? null, initialized: true };
  } catch { return null; }
}

export function saveAviationPreferences(airportIcao: string | null): AviationPreferences {
  const value: AviationPreferences = { airportIcao: normalizeAirportIcao(airportIcao), initialized: true };
  if (typeof window !== "undefined") writeScopedBusinessValue(window.localStorage, AVIATION_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
  return value;
}
