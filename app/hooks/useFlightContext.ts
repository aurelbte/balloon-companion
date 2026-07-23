import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoPoint } from "../types/flight";
import {
  buildFlightContext,
  type FlightContext,
  type FlightContextGpsStatus,
  type LoadedAirspaceCoverage,
} from "../lib/flightContext";
import type { AirspaceFeatureCollection } from "../lib/openaip";
import {
  getAirspaceEvaluationVersion,
  getCoverageEvaluationVersion,
  shouldUpdateFlightContext,
  type FlightContextEvaluationSnapshot,
} from "../lib/flightContextEvaluation";

interface UseFlightContextInput {
  position: GeoPoint | null;
  gpsStatus: FlightContextGpsStatus;
  airspaces: AirspaceFeatureCollection;
  loadedCoverage: LoadedAirspaceCoverage[];
  airspaceDataAvailable: boolean;
}

function createContext(input: UseFlightContextInput): FlightContext {
  return buildFlightContext({
    gps: {
      latitude: input.position?.latitude ?? null,
      longitude: input.position?.longitude ?? null,
      altitudeMeters:
        input.gpsStatus === "ACTIVE" ? (input.position?.altitude ?? null) : null,
      horizontalAccuracyMeters: input.position?.accuracy ?? null,
      verticalAccuracyMeters:
        input.gpsStatus === "ACTIVE"
          ? (input.position?.verticalAccuracy ?? null)
          : null,
      timestamp: input.position?.timestamp ?? null,
      status: input.gpsStatus,
    },
    airspaces: input.airspaces,
    loadedCoverage: input.loadedCoverage,
    airspaceDataAvailable: input.airspaceDataAvailable,
  });
}

export function useFlightContext({
  position,
  gpsStatus,
  airspaces,
  loadedCoverage,
  airspaceDataAvailable,
}: UseFlightContextInput): FlightContext {
  const airspaceVersion = useMemo(
    () => getAirspaceEvaluationVersion(airspaces),
    [airspaces],
  );
  const coverageVersion = useMemo(
    () => getCoverageEvaluationVersion(loadedCoverage),
    [loadedCoverage],
  );
  const snapshot: FlightContextEvaluationSnapshot = {
    position,
    gpsStatus,
    airspaceVersion,
    coverageVersion,
    airspaceDataAvailable,
  };
  const [context, setContext] = useState<FlightContext>(() =>
    createContext({
      position,
      gpsStatus,
      airspaces,
      loadedCoverage,
      airspaceDataAvailable,
    }),
  );
  const lastEvaluationRef =
    useRef<FlightContextEvaluationSnapshot>(snapshot);

  useEffect(() => {
    if (!shouldUpdateFlightContext(lastEvaluationRef.current, snapshot)) {
      return;
    }
    lastEvaluationRef.current = snapshot;
    setContext(
      createContext({
        position,
        gpsStatus,
        airspaces,
        loadedCoverage,
        airspaceDataAvailable,
      }),
    );
  }, [
    airspaceDataAvailable,
    airspaceVersion,
    airspaces,
    coverageVersion,
    gpsStatus,
    loadedCoverage,
    position,
  ]);

  return context;
}
