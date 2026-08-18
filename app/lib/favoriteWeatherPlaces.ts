import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import type { GeocodingResult } from "./trajectory/integration.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";

export const FAVORITE_WEATHER_PLACES_STORAGE_KEY = "balloon-companion-favorite-weather-places-v1";
export const FAVORITE_WEATHER_PLACES_EVENT = "balloon-companion:favorite-weather-places-changed";
const VERSION = 1 as const;

export type FavoriteWeatherPlace = Readonly<{
  id: string;
  /** Identité interne future ; optionnelle pour préserver les favoris historiques. */
  syncId?: string;
  name: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  updatedAt: string;
}>;

function valid(place: Partial<FavoriteWeatherPlace>): place is FavoriteWeatherPlace {
  return typeof place.id === "string" && Boolean(place.id.trim()) && typeof place.name === "string" && Boolean(place.name.trim())
    && typeof place.latitude === "number" && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90
    && typeof place.longitude === "number" && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180
    && typeof place.createdAt === "string" && Number.isFinite(Date.parse(place.createdAt))
    && typeof place.updatedAt === "string" && Number.isFinite(Date.parse(place.updatedAt));
}

function samePlace(left: Pick<FavoriteWeatherPlace, "id" | "latitude" | "longitude">, right: Pick<GeocodingResult, "id" | "latitude" | "longitude">): boolean {
  return left.id === right.id || (Math.abs(left.latitude - right.latitude) < 0.000001 && Math.abs(left.longitude - right.longitude) < 0.000001);
}

export function addOrReuseFavoriteWeatherPlace(favorites: readonly FavoriteWeatherPlace[], place: GeocodingResult, addedAt = new Date().toISOString()): { favorites: FavoriteWeatherPlace[]; selected: FavoriteWeatherPlace } {
  const existing = favorites.find((favorite) => samePlace(favorite, place));
  if (existing) return { favorites: [...favorites], selected: existing };
  const syncId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
  const favorite: FavoriteWeatherPlace = { id: place.id.trim() || `weather-${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}`, ...(syncId ? { syncId } : {}), name: place.name.split(",")[0]?.trim() || place.name.trim(), latitude: place.latitude, longitude: place.longitude, createdAt: addedAt, updatedAt: addedAt };
  return { favorites: [...favorites, favorite], selected: favorite };
}

export function loadFavoriteWeatherPlaces(): FavoriteWeatherPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readScopedBusinessValue(window.localStorage, FAVORITE_WEATHER_PLACES_STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as { version?: unknown; favorites?: unknown };
    if (value.version !== VERSION || !Array.isArray(value.favorites)) return [];
    return value.favorites.filter((place): place is FavoriteWeatherPlace => Boolean(place && typeof place === "object" && valid(place as Partial<FavoriteWeatherPlace>)))
      .filter((place, index, all) => all.findIndex((candidate) => samePlace(candidate, place)) === index);
  } catch { return []; }
}

export function saveFavoriteWeatherPlaces(favorites: readonly FavoriteWeatherPlace[]): boolean {
  if (typeof window === "undefined") return false;
  const saved = writeScopedBusinessValue(window.localStorage, FAVORITE_WEATHER_PLACES_STORAGE_KEY, JSON.stringify({ version: VERSION, favorites }));
  if (saved) { enqueueLocalSyncMutation("favorite-weather-places", "singleton"); window.dispatchEvent(new Event(FAVORITE_WEATHER_PLACES_EVENT)); }
  return saved;
}
