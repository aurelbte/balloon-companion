import { getRuntimeDataScope, readScopedBusinessValue, scopedBusinessStorageKey, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";

export const WEATHER_PREFERENCES_STORAGE_KEY = "balloon-companion-weather-preferences-v1";
export const WEATHER_PREFERENCES_EVENT = "balloon-companion:weather-preferences-changed";
export type WeatherPreferences = { favoriteWeatherLocationId: string | null; weatherModel: string | null };
export const EMPTY_WEATHER_PREFERENCES: WeatherPreferences = { favoriteWeatherLocationId: null, weatherModel: null };

export function loadWeatherPreferences(): WeatherPreferences {
  if (typeof window === "undefined") return EMPTY_WEATHER_PREFERENCES;
  try {
    const value: unknown = JSON.parse(readScopedBusinessValue(window.localStorage, WEATHER_PREFERENCES_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return EMPTY_WEATHER_PREFERENCES;
    const candidate = value as Partial<WeatherPreferences>;
    return { favoriteWeatherLocationId: typeof candidate.favoriteWeatherLocationId === "string" ? candidate.favoriteWeatherLocationId : null, weatherModel: typeof candidate.weatherModel === "string" ? candidate.weatherModel : null };
  } catch { return EMPTY_WEATHER_PREFERENCES; }
}

export function saveWeatherPreferences(value: WeatherPreferences): boolean {
  if (typeof window === "undefined") return false;
  const saved = writeScopedBusinessValue(window.localStorage, WEATHER_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
  if (saved) enqueueLocalSyncMutation("weather-preferences", "singleton");
  if (saved) window.dispatchEvent(new Event(WEATHER_PREFERENCES_EVENT));
  return saved;
}

/** Pull-only hydration primitive; deliberately bypasses the mutation outbox. */
export function applyWeatherPreferencesFromCloudWithoutEnqueue(scope: `USER:${string}`, value: unknown, deleted: boolean, storage: Storage = window.localStorage): boolean {
  if (getRuntimeDataScope() !== scope) return false;
  const key = scopedBusinessStorageKey(scope, WEATHER_PREFERENCES_STORAGE_KEY);
  if (deleted) storage.removeItem(key);
  else {
    const candidate = value && typeof value === "object" ? value as Partial<WeatherPreferences> : EMPTY_WEATHER_PREFERENCES;
    storage.setItem(key, JSON.stringify({
      favoriteWeatherLocationId: typeof candidate.favoriteWeatherLocationId === "string" ? candidate.favoriteWeatherLocationId : null,
      weatherModel: typeof candidate.weatherModel === "string" ? candidate.weatherModel : null,
    } satisfies WeatherPreferences));
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WEATHER_PREFERENCES_EVENT));
  return true;
}
