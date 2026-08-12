import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";

export const WEATHER_PREFERENCES_STORAGE_KEY = "balloon-companion-weather-preferences-v1";
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
  return typeof window !== "undefined" && writeScopedBusinessValue(window.localStorage, WEATHER_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
}
