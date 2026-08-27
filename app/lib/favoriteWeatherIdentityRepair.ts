import { getRuntimeDataScope, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { FAVORITE_WEATHER_PLACES_EVENT, FAVORITE_WEATHER_PLACES_STORAGE_KEY, type FavoriteWeatherPlace } from "./favoriteWeatherPlaces.ts";
import type { FavoriteWeatherPlaceCloudRow } from "./cloudPullService.ts";
import type { SyncMutation, SyncOutboxStorage } from "./syncOutbox.ts";
import { WEATHER_PREFERENCES_EVENT, WEATHER_PREFERENCES_STORAGE_KEY, type WeatherPreferences } from "./weatherPreferencesStorage.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function repairFavoriteWeatherTombstoneIdentityCollision(input: Readonly<{
  scope: `USER:${string}`;
  storage: Storage;
  outbox: Pick<SyncOutboxStorage, "enqueue" | "enqueueFresh" | "remove" | "removeMany">;
  row: FavoriteWeatherPlaceCloudRow;
  pending: readonly SyncMutation[];
  createId?: () => string;
}>): Promise<Readonly<{ repaired: boolean; oldEntityId?: string; newEntityId?: string }>> {
  if (getRuntimeDataScope() !== input.scope || !input.row.deletedAt || !input.row.syncId || !UUID.test(input.row.syncId)) return { repaired: false };
  const weatherKey = scopedBusinessStorageKey(input.scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY);
  const preferencesKey = scopedBusinessStorageKey(input.scope, WEATHER_PREFERENCES_STORAGE_KEY);
  let container: { version: unknown; favorites: FavoriteWeatherPlace[] };
  try {
    const parsed = JSON.parse(input.storage.getItem(weatherKey) ?? "null") as { version?: unknown; favorites?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.favorites)) return { repaired: false };
    container = { version: parsed.version, favorites: parsed.favorites as FavoriteWeatherPlace[] };
  } catch { return { repaired: false }; }
  const local = container.favorites.find(({ id }) => id === input.row.id);
  const conflicting = input.pending.filter(({ entityType, entityId, operation }) => entityType === "favorite-weather-place" && entityId === input.row.id && operation === "UPSERT");
  if (!local?.syncId || !UUID.test(local.syncId) || local.syncId === input.row.syncId || conflicting.length === 0) return { repaired: false };
  const newEntityId = (input.createId ?? (() => crypto.randomUUID()))();
  if (!UUID.test(newEntityId) || newEntityId === input.row.id || container.favorites.some(({ id }) => id === newEntityId)) throw new Error("Invalid replacement favorite identity");
  const replacement: FavoriteWeatherPlace = { ...local, id: newEntityId, syncId: newEntityId, sourceId: local.sourceId ?? local.id };
  const nextFavorites = container.favorites.map((favorite) => favorite.id === local.id ? replacement : favorite);
  const fresh = await input.outbox.enqueueFresh({ entityType: "favorite-weather-place", entityId: newEntityId, operation: "UPSERT", baseRevision: 0 });
  const previousWeatherRaw = input.storage.getItem(weatherKey);
  const previousPreferencesRaw = input.storage.getItem(preferencesKey);
  try {
    if (getRuntimeDataScope() !== input.scope) throw new Error("USER_SWITCH");
    input.storage.setItem(weatherKey, JSON.stringify({ version: container.version, favorites: nextFavorites }));
    const preferences = JSON.parse(input.storage.getItem(preferencesKey) ?? "null") as Partial<WeatherPreferences> | null;
    if (preferences?.favoriteWeatherLocationId === local.id) {
      input.storage.setItem(preferencesKey, JSON.stringify({ ...preferences, favoriteWeatherLocationId: newEntityId }));
      await input.outbox.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
    }
    await input.outbox.removeMany(conflicting.map(({ mutationId }) => mutationId));
  } catch (error) {
    if (previousWeatherRaw === null) input.storage.removeItem(weatherKey); else input.storage.setItem(weatherKey, previousWeatherRaw);
    if (previousPreferencesRaw === null) input.storage.removeItem(preferencesKey); else input.storage.setItem(preferencesKey, previousPreferencesRaw);
    await input.outbox.remove(fresh.mutationId);
    throw error;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FAVORITE_WEATHER_PLACES_EVENT));
    window.dispatchEvent(new Event(WEATHER_PREFERENCES_EVENT));
  }
  return { repaired: true, oldEntityId: local.id, newEntityId };
}
