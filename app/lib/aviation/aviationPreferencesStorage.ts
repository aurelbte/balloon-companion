import { readScopedBusinessValue, writeScopedBusinessValue } from "../auth/dataScopeRuntime.ts";
import { normalizeAirportIcao } from "./aviationWeather.ts";
import { enqueueLocalSyncMutation } from "../syncOutbox.ts";

export const AVIATION_PREFERENCES_STORAGE_KEY = "balloon-companion-aviation-preferences-v1";
export type AviationAirportFavorite = { icao: string; name: string };
export type AviationPreferences = { airportIcao: string | null; favorites: AviationAirportFavorite[]; initialized: true };

export function loadAviationPreferences(): AviationPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(readScopedBusinessValue(window.localStorage, AVIATION_PREFERENCES_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || (value as { initialized?: unknown }).initialized !== true) return null;
    const airportIcao = normalizeAirportIcao((value as { airportIcao?: string | null }).airportIcao) ?? null;
    const favorites = Array.isArray((value as { favorites?: unknown }).favorites) ? (value as { favorites: unknown[] }).favorites.flatMap((item) => { if (!item || typeof item !== "object") return []; const icao = normalizeAirportIcao((item as { icao?: string }).icao); const name = (item as { name?: unknown }).name; return icao && typeof name === "string" && name.trim() ? [{ icao, name: name.trim() }] : []; }) : airportIcao ? [{ icao: airportIcao, name: airportIcao }] : [];
    return { airportIcao, favorites, initialized: true };
  } catch { return null; }
}

export function saveAviationPreferences(airportIcao: string | null, favorites: readonly AviationAirportFavorite[] = []): AviationPreferences {
  const normalizedAirport = normalizeAirportIcao(airportIcao);
  const normalizedFavorites = favorites.flatMap(({ icao, name }) => { const code = normalizeAirportIcao(icao); return code && name.trim() ? [{ icao: code, name: name.trim() }] : []; }).filter((item, index, all) => all.findIndex(({ icao }) => icao === item.icao) === index);
  const value: AviationPreferences = { airportIcao: normalizedAirport, favorites: normalizedFavorites, initialized: true };
  if (typeof window !== "undefined" && writeScopedBusinessValue(window.localStorage, AVIATION_PREFERENCES_STORAGE_KEY, JSON.stringify(value))) enqueueLocalSyncMutation("aviation-preferences", "singleton");
  return value;
}
