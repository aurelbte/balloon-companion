import { getRuntimeDataScope, readScopedBusinessValue, scopedBusinessStorageKey, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
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

export function addOrReuseFavoriteWeatherPlace(favorites: readonly FavoriteWeatherPlace[], place: GeocodingResult, addedAt = new Date().toISOString(), displayName?: string): { favorites: FavoriteWeatherPlace[]; selected: FavoriteWeatherPlace } {
  const existing = favorites.find((favorite) => samePlace(favorite, place));
  if (existing) return { favorites: [...favorites], selected: existing };
  const syncId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
  const favorite: FavoriteWeatherPlace = { id: place.id.trim() || `weather-${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}`, ...(syncId ? { syncId } : {}), name: displayName?.trim() || place.name.split(",")[0]?.trim() || place.name.trim(), latitude: place.latitude, longitude: place.longitude, createdAt: addedAt, updatedAt: addedAt };
  return { favorites: [...favorites, favorite], selected: favorite };
}

export function renameFavoriteWeatherPlace(favorites: readonly FavoriteWeatherPlace[], favoriteId: string, name: string, updatedAt = new Date().toISOString()): FavoriteWeatherPlace[] {
  const normalizedName = name.trim();
  if (!normalizedName) return [...favorites];
  return favorites.map((favorite) => favorite.id === favoriteId ? { ...favorite, name: normalizedName, updatedAt } : favorite);
}

export function removeFavoriteWeatherPlace(favorites: readonly FavoriteWeatherPlace[], favoriteId: string): FavoriteWeatherPlace[] {
  return favorites.filter(({ id }) => id !== favoriteId);
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

export type CloudFavoriteWeatherPlace = Readonly<{
  id: string;
  syncId?: string;
  name: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

/** Pull-only hydration primitive. It never calls the outbox or emits its enqueue event. */
export function applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(
  scope: `USER:${string}`,
  cloud: CloudFavoriteWeatherPlace,
  storage: Storage = window.localStorage,
): boolean {
  if (getRuntimeDataScope() !== scope) return false;
  const key = scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY);
  let current: FavoriteWeatherPlace[] = [];
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null") as { version?: unknown; favorites?: unknown } | null;
    if (value?.version === VERSION && Array.isArray(value.favorites)) {
      current = value.favorites.filter((place): place is FavoriteWeatherPlace => Boolean(place && typeof place === "object" && valid(place as Partial<FavoriteWeatherPlace>)));
    }
  } catch {}
  const retained = current.filter(({ id }) => id !== cloud.id);
  const next = cloud.deletedAt ? retained : [...retained, {
    id: cloud.id,
    ...(cloud.syncId ? { syncId: cloud.syncId } : {}),
    name: cloud.name,
    latitude: cloud.latitude,
    longitude: cloud.longitude,
    createdAt: cloud.createdAt,
    updatedAt: cloud.updatedAt,
  }];
  storage.setItem(key, JSON.stringify({ version: VERSION, favorites: next }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FAVORITE_WEATHER_PLACES_EVENT));
  return true;
}

export function saveFavoriteWeatherPlaces(favorites: readonly FavoriteWeatherPlace[]): boolean {
  if (typeof window === "undefined") return false;
  const previous = loadFavoriteWeatherPlaces();
  const saved = writeScopedBusinessValue(window.localStorage, FAVORITE_WEATHER_PLACES_STORAGE_KEY, JSON.stringify({ version: VERSION, favorites }));
  if (saved) {
    for (const favorite of favorites) {
      const prior = previous.find(({ id }) => id === favorite.id);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(favorite)) enqueueLocalSyncMutation("favorite-weather-place", favorite.id);
    }
    for (const removed of previous.filter(({ id }) => !favorites.some((favorite) => favorite.id === id))) {
      enqueueLocalSyncMutation("favorite-weather-place", removed.id, "DELETE");
    }
    window.dispatchEvent(new Event(FAVORITE_WEATHER_PLACES_EVENT));
  }
  return saved;
}

export async function saveFavoriteWeatherPlacesWithDurableOutbox(
  favorites: readonly FavoriteWeatherPlace[],
  enqueue: typeof enqueueLocalSyncMutation = enqueueLocalSyncMutation,
): Promise<boolean> {
  if (getRuntimeDataScope() === "GUEST") return saveFavoriteWeatherPlaces(favorites);
  if (typeof window === "undefined") return false;
  const previous = loadFavoriteWeatherPlaces();
  const saved = writeScopedBusinessValue(window.localStorage, FAVORITE_WEATHER_PLACES_STORAGE_KEY, JSON.stringify({ version: VERSION, favorites }));
  if (!saved) return false;
  const mutations = [
    ...favorites.flatMap((favorite) => {
      const prior = previous.find(({ id }) => id === favorite.id);
      return !prior || JSON.stringify(prior) !== JSON.stringify(favorite) ? [{ entityId: favorite.id, operation: "UPSERT" as const }] : [];
    }),
    ...previous.filter(({ id }) => !favorites.some((favorite) => favorite.id === id)).map(({ id }) => ({ entityId: id, operation: "DELETE" as const })),
  ];
  const durable = (await Promise.all(mutations.map(({ entityId, operation }) => enqueue("favorite-weather-place", entityId, operation)))).every(Boolean);
  if (!durable) {
    writeScopedBusinessValue(window.localStorage, FAVORITE_WEATHER_PLACES_STORAGE_KEY, JSON.stringify({ version: VERSION, favorites: previous }));
    return false;
  }
  window.dispatchEvent(new Event(FAVORITE_WEATHER_PLACES_EVENT));
  return true;
}
