"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_WEATHER_PREFERENCES, loadWeatherPreferences, saveWeatherPreferences, type WeatherPreferences } from "../lib/weatherPreferencesStorage";

type WeatherPreferencesContextValue = WeatherPreferences & { setFavoriteWeatherLocationId(id: string | null): void; setWeatherModel(model: string | null): void };
const WeatherPreferencesContext = createContext<WeatherPreferencesContextValue | null>(null);

export function WeatherPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<WeatherPreferences>(EMPTY_WEATHER_PREFERENCES);
  useEffect(() => { setPreferences(loadWeatherPreferences()); }, []);
  const update = useCallback((changes: Partial<WeatherPreferences>) => setPreferences((current) => { const next = { ...current, ...changes }; saveWeatherPreferences(next); return next; }), []);
  const value = useMemo(() => ({ ...preferences, setFavoriteWeatherLocationId: (id: string | null) => update({ favoriteWeatherLocationId: id }), setWeatherModel: (model: string | null) => update({ weatherModel: model }) }), [preferences, update]);
  return <WeatherPreferencesContext.Provider value={value}>{children}</WeatherPreferencesContext.Provider>;
}

export function useWeatherPreferences(): WeatherPreferencesContextValue {
  const value = useContext(WeatherPreferencesContext);
  if (!value) throw new Error("useWeatherPreferences must be used inside WeatherPreferencesProvider");
  return value;
}
