"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { addOrReuseFavoriteWeatherPlace, FAVORITE_WEATHER_PLACES_EVENT, loadFavoriteWeatherPlaces, saveFavoriteWeatherPlaces, type FavoriteWeatherPlace } from "../lib/favoriteWeatherPlaces";
import type { GeocodingResult } from "../lib/trajectory/integration";
import { loadHourlyWeatherForecast } from "../lib/weather/hourlyForecastService";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import type { OpenMeteoWeatherModel, WeatherHourlyPoint } from "../lib/weather/openMeteo/types";
import { availableDays, availableTimes, closestAvailableDay, closestAvailableTime, dayKey, timeKey } from "../lib/weather/weatherSelection";
import { EMPTY_WEATHER_PREFERENCES, loadWeatherPreferences, saveWeatherPreferences, type WeatherPreferences } from "../lib/weatherPreferencesStorage";
import { calculateSunTimes, type SunTimes } from "../lib/weather/sunTimes";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";

type WeatherPreferencesContextValue = WeatherPreferences & {
  favorites: readonly FavoriteWeatherPlace[];
  activeFavorite: FavoriteWeatherPlace | null;
  modelName: string;
  selectedDay?: string;
  selectedTime?: string;
  selectedPoint: WeatherHourlyPoint | null;
  sunTimes: SunTimes | null;
  days: readonly string[];
  times: readonly string[];
  dayIndex: number;
  timeIndex: number;
  loading: boolean;
  error: boolean;
  setFavoriteWeatherLocationId(id: string | null): void;
  addFavoriteWeatherLocation(site: GeocodingResult): void;
  setWeatherModel(model: string | null): void;
  changeDay(offset: number): void;
  changeTime(offset: number): void;
  retry(): void;
  resetToCurrent(): void;
};
const WeatherPreferencesContext = createContext<WeatherPreferencesContextValue | null>(null);

export function WeatherPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<WeatherPreferences>(EMPTY_WEATHER_PREFERENCES);
  const [favorites, setFavorites] = useState<FavoriteWeatherPlace[]>([]);
  const [points, setPoints] = useState<readonly WeatherHourlyPoint[]>([]);
  const [forecastTimeZone, setForecastTimeZone] = useState<string>();
  const [selectedDay, setSelectedDay] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => { const refresh = () => { setPreferences(loadWeatherPreferences()); setFavorites(loadFavoriteWeatherPlaces()); setPoints([]); setForecastTimeZone(undefined); setSelectedDay(undefined); setSelectedTime(undefined); }; refresh(); window.addEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); window.addEventListener(FAVORITE_WEATHER_PLACES_EVENT, refresh); return () => { window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); window.removeEventListener(FAVORITE_WEATHER_PLACES_EVENT, refresh); }; }, []);
  const update = useCallback((changes: Partial<WeatherPreferences>) => setPreferences((current) => { const next = { ...current, ...changes }; saveWeatherPreferences(next); return next; }), []);
  const activeFavorite = favorites.find(({ id }) => id === preferences.favoriteWeatherLocationId) ?? null;
  const coordinates = useMemo(() => activeFavorite ? { latitude: activeFavorite.latitude, longitude: activeFavorite.longitude } : null, [activeFavorite]);

  useEffect(() => {
    if (!coordinates || !preferences.weatherModel) { setPoints([]); setForecastTimeZone(undefined); setLoading(false); setError(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(false);
    loadHourlyWeatherForecast({ ...coordinates, weatherModel: preferences.weatherModel as OpenMeteoWeatherModel }, controller.signal)
      .then(({ points: next, timezone }) => { setPoints(next); setForecastTimeZone(timezone); setLoading(false); })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) { setPoints([]); setLoading(false); setError(true); } });
    return () => controller.abort();
  }, [coordinates, preferences.weatherModel, retryKey]);

  const days = useMemo(() => availableDays(points), [points]);
  const times = useMemo(() => selectedDay ? availableTimes(points, selectedDay) : [], [points, selectedDay]);
  useEffect(() => {
    const now = new Date();
    const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const localTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const nextDay = selectedDay && days.includes(selectedDay) ? selectedDay : closestAvailableDay(days, localDay);
    setSelectedDay(nextDay);
    setSelectedTime((current) => closestAvailableTime(nextDay ? availableTimes(points, nextDay) : [], current ?? localTime));
  }, [days, points, selectedDay]);

  const dayIndex = selectedDay ? days.indexOf(selectedDay) : -1;
  const timeIndex = selectedTime ? times.indexOf(selectedTime) : -1;
  const selectedPoint = points.find((point) => dayKey(point.timestamp) === selectedDay && timeKey(point.timestamp) === selectedTime) ?? null;
  const sunTimes = useMemo(() => calculateSunTimes(selectedDay, activeFavorite?.latitude, activeFavorite?.longitude, forecastTimeZone), [selectedDay, activeFavorite, forecastTimeZone]);
  const changeDay = useCallback((offset: number) => { const day = days[dayIndex + offset]; if (!day) return; setSelectedDay(day); setSelectedTime((current) => closestAvailableTime(availableTimes(points, day), current)); }, [dayIndex, days, points]);
  const changeTime = useCallback((offset: number) => { const time = times[timeIndex + offset]; if (time) { setSelectedTime(time); return; } const adjacentDay = days[dayIndex + offset]; if (!adjacentDay) return; const adjacentTimes = availableTimes(points, adjacentDay); const adjacentTime = offset > 0 ? adjacentTimes[0] : adjacentTimes.at(-1); if (adjacentTime) { setSelectedDay(adjacentDay); setSelectedTime(adjacentTime); } }, [dayIndex, days, points, timeIndex, times]);
  const resetToCurrent = useCallback(() => { const now = new Date(); const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; const localTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; const day = closestAvailableDay(days, localDay); setSelectedDay(day); setSelectedTime(closestAvailableTime(day ? availableTimes(points, day) : [], localTime)); }, [days, points]);
  const modelName = SUPPORTED_WEATHER_MODELS.find(({ providerModelId }) => providerModelId === preferences.weatherModel)?.label ?? preferences.weatherModel ?? "";
  const addFavoriteWeatherLocation = useCallback((site: GeocodingResult) => {
    const result = addOrReuseFavoriteWeatherPlace(favorites, site);
    const nextPreferences = { ...preferences, favoriteWeatherLocationId: result.selected.id };
    saveWeatherPreferences(nextPreferences);
    saveFavoriteWeatherPlaces(result.favorites);
    setPreferences(nextPreferences);
    setFavorites(result.favorites);
  }, [favorites, preferences]);
  const value = useMemo<WeatherPreferencesContextValue>(() => ({ ...preferences, favorites, activeFavorite, modelName, selectedDay, selectedTime, selectedPoint, sunTimes, days, times, dayIndex, timeIndex, loading, error, setFavoriteWeatherLocationId: (id) => update({ favoriteWeatherLocationId: id }), addFavoriteWeatherLocation, setWeatherModel: (model) => update({ weatherModel: model }), changeDay, changeTime, resetToCurrent, retry: () => setRetryKey((current) => current + 1) }), [preferences, favorites, activeFavorite, modelName, selectedDay, selectedTime, selectedPoint, sunTimes, days, times, dayIndex, timeIndex, loading, error, update, addFavoriteWeatherLocation, changeDay, changeTime, resetToCurrent]);
  return <WeatherPreferencesContext.Provider value={value}>{children}</WeatherPreferencesContext.Provider>;
}

export function useWeatherPreferences(): WeatherPreferencesContextValue {
  const value = useContext(WeatherPreferencesContext);
  if (!value) throw new Error("useWeatherPreferences must be used inside WeatherPreferencesProvider");
  return value;
}
