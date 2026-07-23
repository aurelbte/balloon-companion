"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useFlightTracking } from "../hooks/useFlightTracking";
import { useGeolocation } from "../hooks/useGeolocation";
import { useWakeLock } from "../hooks/useWakeLock";

type FlightRuntimeValue = {
  geolocation: ReturnType<typeof useGeolocation>;
  tracking: ReturnType<typeof useFlightTracking>;
};

const FlightRuntimeContext = createContext<FlightRuntimeValue | null>(null);

export function FlightRuntimeProvider({ children }: { children: ReactNode }) {
  const geolocation = useGeolocation({
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000,
    enableDevelopmentTestMode: true,
  });
  const tracking = useFlightTracking();
  useWakeLock(tracking.isTracking);

  useEffect(() => {
    if (
      tracking.isTracking &&
      geolocation.point &&
      !geolocation.isStale
    ) {
      tracking.addPoint(geolocation.point);
    }
  }, [
    geolocation.isStale,
    geolocation.point,
    tracking.addPoint,
    tracking.isTracking,
  ]);

  return (
    <FlightRuntimeContext.Provider value={{ geolocation, tracking }}>
      {children}
    </FlightRuntimeContext.Provider>
  );
}

export function useFlightRuntime(): FlightRuntimeValue {
  const value = useContext(FlightRuntimeContext);
  if (!value) {
    throw new Error(
      "useFlightRuntime doit être utilisé dans FlightRuntimeProvider",
    );
  }
  return value;
}
