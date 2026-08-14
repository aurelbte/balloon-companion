"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";
import { DEFAULT_UNIT_PREFERENCES, type UnitPreferences } from "../lib/unitPreferences";
import { loadUnitPreferences, saveUnitPreferences } from "../lib/unitPreferencesStorage";

type UnitPreferencesContextValue = UnitPreferences & { updateUnitPreferences(changes: Partial<UnitPreferences>): void };
const UnitPreferencesContext = createContext<UnitPreferencesContextValue | null>(null);

export function UnitPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_UNIT_PREFERENCES);
  useEffect(() => {
    const refresh = () => setPreferences(loadUnitPreferences());
    refresh();
    window.addEventListener(DATA_SCOPE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, refresh);
  }, []);
  const updateUnitPreferences = useCallback((changes: Partial<UnitPreferences>) => setPreferences((current) => {
    const next = {
      weather: { ...current.weather, ...changes.weather },
      flightInstruments: { ...current.flightInstruments, ...changes.flightInstruments },
    };
    saveUnitPreferences(next);
    return next;
  }), []);
  const value = useMemo(() => ({ ...preferences, updateUnitPreferences }), [preferences, updateUnitPreferences]);
  return <UnitPreferencesContext.Provider value={value}>{children}</UnitPreferencesContext.Provider>;
}

export function useUnitPreferences(): UnitPreferencesContextValue {
  const value = useContext(UnitPreferencesContext);
  if (!value) throw new Error("useUnitPreferences must be used inside UnitPreferencesProvider");
  return value;
}
