"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addOrReuseFavoriteWeatherPlace, FAVORITE_WEATHER_PLACES_EVENT, loadFavoriteWeatherPlaces, removeFavoriteWeatherPlace, renameFavoriteWeatherPlace, saveFavoriteWeatherPlaces, saveFavoriteWeatherPlacesWithDurableOutbox, type FavoriteWeatherPlace } from "../lib/favoriteWeatherPlaces";
import type { GeocodingResult } from "../lib/trajectory/integration";
import { startHourlyForecastRuntime } from "../lib/weather/hourlyForecastRuntime";
import { classifyWeatherFreshness, HOURLY_POLICY, type WeatherFreshness } from "../lib/weather/weatherFreshness";
import { getRuntimeDataScopeGeneration } from "../lib/auth/dataScopeRuntime";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import type { WeatherHourlyPoint } from "../lib/weather/openMeteo/types";
import { availableDays, availableTimes, closestAvailableDay, closestAvailableTime, dayKey, timeKey } from "../lib/weather/weatherSelection";
import { EMPTY_WEATHER_PREFERENCES, loadWeatherPreferences, saveWeatherPreferences, WEATHER_PREFERENCES_EVENT, type WeatherPreferences } from "../lib/weatherPreferencesStorage";
import { calculateSunTimes, type SunTimes } from "../lib/weather/sunTimes";
import { currentWeatherSelection, watchCurrentWeather, type CurrentWeatherSelection } from "../lib/weather/currentWeather";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";
import { getRuntimeDataScope } from "../lib/auth/dataScopeRuntime";
import { recordFavoriteWeatherUiHydration } from "../lib/favoriteWeatherPullDiagnostics";

type WeatherPreferencesContextValue = WeatherPreferences & {
  favorites: readonly FavoriteWeatherPlace[];
  activeFavorite: FavoriteWeatherPlace | null;
  modelName: string;
  selectedDay?: string;
  selectedTime?: string;
  selectedPoint: WeatherHourlyPoint | null;
  currentWeather: CurrentWeatherSelection;
  currentSunTimes: SunTimes | null;
  sunTimes: SunTimes | null;
  days: readonly string[];
  times: readonly string[];
  dayIndex: number;
  timeIndex: number;
  loading: boolean;
  error: boolean;
  freshness: WeatherFreshness;
  setFavoriteWeatherLocationId(id: string | null): void;
  addFavoriteWeatherLocation(site: GeocodingResult, displayName?: string): void;
  renameFavoriteWeatherLocation(id: string, name: string): void;
  removeFavoriteWeatherLocation(id: string): Promise<boolean>;
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
  const activeFavorite = favorites.find(({ id }) => id === preferences.favoriteWeatherLocationId) ?? null;
  const queryIdentity = activeFavorite && preferences.weatherModel ? `${activeFavorite.latitude}:${activeFavorite.longitude}:${preferences.weatherModel}` : null;
  const [datasetIdentity, setDatasetIdentity] = useState<string | null>(null);
  const [storedPoints, setPoints] = useState<readonly WeatherHourlyPoint[]>([]);
  const points = useMemo(() => datasetIdentity === queryIdentity ? storedPoints : [], [datasetIdentity, queryIdentity, storedPoints]);
  const [storedTimeZone, setForecastTimeZone] = useState<string>();
  const forecastTimeZone = datasetIdentity === queryIdentity ? storedTimeZone : undefined;
  const [currentClock, setCurrentClock] = useState<number | null>(null);
  useEffect(() => watchCurrentWeather(points, forecastTimeZone, () => setCurrentClock(Date.now())), [points, forecastTimeZone]);
  const currentWeather = useMemo(() => currentClock === null ? { point: null, validAt: null } : currentWeatherSelection(points, forecastTimeZone, currentClock).selection, [points, forecastTimeZone, currentClock]);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const hourlyRuntime = useRef<ReturnType<typeof startHourlyForecastRuntime> | null>(null);
  const [datasetFetchedAt, setDatasetFetchedAt] = useState<string>();
  const [freshnessClock, setFreshnessClock] = useState<number | null>(null);
  const freshness = classifyWeatherFreshness(freshnessClock ?? NaN, datasetIdentity === queryIdentity ? datasetFetchedAt : undefined, HOURLY_POLICY);

  useEffect(() => { const refresh = () => { setPreferences(loadWeatherPreferences()); setFavorites(loadFavoriteWeatherPlaces()); setPoints([]); setForecastTimeZone(undefined); setSelectedDay(undefined); setSelectedTime(undefined); }; refresh(); window.addEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); window.addEventListener(FAVORITE_WEATHER_PLACES_EVENT, refresh); window.addEventListener(WEATHER_PREFERENCES_EVENT, refresh); return () => { window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, refresh); window.removeEventListener(FAVORITE_WEATHER_PLACES_EVENT, refresh); window.removeEventListener(WEATHER_PREFERENCES_EVENT, refresh); }; }, []);
  const update = useCallback((changes: Partial<WeatherPreferences>) => setPreferences((current) => { const next = { ...current, ...changes }; saveWeatherPreferences(next); return next; }), []);
  useEffect(() => {
    recordFavoriteWeatherUiHydration({
      scope: getRuntimeDataScope(),
      favorites,
      selectedFavoriteId: preferences.favoriteWeatherLocationId,
    });
  }, [favorites, preferences.favoriteWeatherLocationId]);
  const currentDay = currentWeather.point ? dayKey(currentWeather.point.timestamp) : undefined;
  const currentSunTimes = useMemo(() => calculateSunTimes(currentDay, activeFavorite?.latitude, activeFavorite?.longitude, forecastTimeZone), [currentDay, activeFavorite, forecastTimeZone]);
  const coordinates = useMemo(() => activeFavorite ? { latitude: activeFavorite.latitude, longitude: activeFavorite.longitude } : null, [activeFavorite]);

  useEffect(() => {
    if (!coordinates || !preferences.weatherModel) { setPoints([]); setForecastTimeZone(undefined); setLoading(false); setError(false); return; }
    const scope = getRuntimeDataScope(), generation = getRuntimeDataScopeGeneration();
    const runtime = startHourlyForecastRuntime({ ...coordinates, weatherModel: preferences.weatherModel }, state => {
      setDatasetIdentity(queryIdentity);
      setPoints(state.data?.points ?? []); setForecastTimeZone(state.data?.timezone);
      setDatasetFetchedAt(state.data?.sourceUpdatedAt); setFreshnessClock(state.now);
      setLoading(state.loading); setError(state.error);
    }, () => getRuntimeDataScope() === scope && getRuntimeDataScopeGeneration() === generation);
    hourlyRuntime.current = runtime;
    return () => { runtime.stop(); if (hourlyRuntime.current === runtime) hourlyRuntime.current = null; };
  }, [coordinates, preferences.weatherModel, queryIdentity]);

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
  const addFavoriteWeatherLocation = useCallback((site: GeocodingResult, displayName?: string) => {
    const result = addOrReuseFavoriteWeatherPlace(favorites, site, new Date().toISOString(), displayName);
    const nextPreferences = { ...preferences, favoriteWeatherLocationId: result.selected.id };
    saveWeatherPreferences(nextPreferences);
    saveFavoriteWeatherPlaces(result.favorites);
    setPreferences(nextPreferences);
    setFavorites(result.favorites);
  }, [favorites, preferences]);
  const renameFavoriteWeatherLocation = useCallback((id: string, name: string) => {
    const next = renameFavoriteWeatherPlace(favorites, id, name);
    if (saveFavoriteWeatherPlaces(next)) setFavorites(next);
  }, [favorites]);
  const removeFavoriteWeatherLocation = useCallback(async (id: string) => {
    const next = removeFavoriteWeatherPlace(favorites, id);
    const nextSelectedId = preferences.favoriteWeatherLocationId === id ? next[0]?.id ?? null : preferences.favoriteWeatherLocationId;
    if (!await saveFavoriteWeatherPlacesWithDurableOutbox(next)) return false;
    if (nextSelectedId !== preferences.favoriteWeatherLocationId) saveWeatherPreferences({ ...preferences, favoriteWeatherLocationId: nextSelectedId });
    setFavorites(next);
    setPreferences((current) => ({ ...current, favoriteWeatherLocationId: nextSelectedId }));
    return true;
  }, [favorites, preferences]);
  const value = useMemo<WeatherPreferencesContextValue>(() => ({ ...preferences, favorites, activeFavorite, modelName, selectedDay, selectedTime, selectedPoint, currentWeather, currentSunTimes, sunTimes, days, times, dayIndex, timeIndex, loading, error, freshness, setFavoriteWeatherLocationId: (id) => update({ favoriteWeatherLocationId: id }), addFavoriteWeatherLocation, renameFavoriteWeatherLocation, removeFavoriteWeatherLocation, setWeatherModel: (model) => update({ weatherModel: model }), changeDay, changeTime, resetToCurrent, retry: () => hourlyRuntime.current?.retry() }), [preferences, favorites, activeFavorite, modelName, selectedDay, selectedTime, selectedPoint, currentWeather, currentSunTimes, sunTimes, days, times, dayIndex, timeIndex, loading, error, freshness, update, addFavoriteWeatherLocation, renameFavoriteWeatherLocation, removeFavoriteWeatherLocation, changeDay, changeTime, resetToCurrent]);
  return <WeatherPreferencesContext.Provider value={value}>{children}</WeatherPreferencesContext.Provider>;
}

export function useWeatherPreferences(): WeatherPreferencesContextValue {
  const value = useContext(WeatherPreferencesContext);
  if (!value) throw new Error("useWeatherPreferences must be used inside WeatherPreferencesProvider");
  return value;
}
