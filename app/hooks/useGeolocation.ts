/**
 * Hook pour la géolocalisation en temps réel
 * Utilise navigator.geolocation.watchPosition
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GeoPoint, GeolocationState } from "../types/flight";

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
  enableDevelopmentTestMode?: boolean;
  onLocationChange?: (point: GeoPoint) => void;
}

interface UseGeolocationResult {
  point: GeoPoint | null;
  state: GeolocationState;
  error: string | null;
  isStale: boolean;
  positionAgeMs: number | null;
  requestPermission: () => void;
  stopTracking: () => void;
}

const STALE_POSITION_MS = 10_000;
const MAX_ACCEPTED_ACCURACY_METERS = 100;
const MAX_PLAUSIBLE_SPEED_KMH = 200;
const JUMP_TOLERANCE_METERS = 500;

function isUsablePoint(point: GeoPoint, previous: GeoPoint | null): boolean {
  if (
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180 ||
    point.accuracy === null ||
    !Number.isFinite(point.accuracy) ||
    point.accuracy > MAX_ACCEPTED_ACCURACY_METERS ||
    !Number.isFinite(point.timestamp)
  ) {
    return false;
  }

  if (!previous) return true;
  if (point.timestamp < previous.timestamp) return false;

  const latitudeMeters = (point.latitude - previous.latitude) * 111_320;
  const longitudeMeters =
    (point.longitude - previous.longitude) *
    111_320 *
    Math.cos((previous.latitude * Math.PI) / 180);
  const distanceMeters = Math.hypot(latitudeMeters, longitudeMeters);
  const elapsedHours = (point.timestamp - previous.timestamp) / 3_600_000;
  const plausibleDistance = Math.max(
    JUMP_TOLERANCE_METERS,
    elapsedHours * MAX_PLAUSIBLE_SPEED_KMH * 1000
  );

  // Ce garde-fou élimine uniquement les téléportations GPS manifestes. Il ne
  // constitue ni une validation aéronautique, ni une garantie de précision.
  return distanceMeters <= plausibleDistance;
}

interface SimulationState {
  latitude: number;
  longitude: number;
  elapsedSeconds: number;
}

function isDevelopmentTestRequest(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return false;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(
    window.location.hostname
  );
  return (
    isLocalhost && new URLSearchParams(window.location.search).get("test") === "1"
  );
}

function generateSimulatedPosition(state: SimulationState): GeoPoint {
  const speed = 17 + Math.sin(state.elapsedSeconds / 18) * 5;
  const heading = (55 + Math.sin(state.elapsedSeconds / 25) * 35 + 360) % 360;
  const distanceMeters = speed / 3.6;
  const headingRadians = (heading * Math.PI) / 180;

  state.latitude += (Math.cos(headingRadians) * distanceMeters) / 111_320;
  state.longitude +=
    (Math.sin(headingRadians) * distanceMeters) /
    (111_320 * Math.cos((state.latitude * Math.PI) / 180));
  state.elapsedSeconds += 1;

  return {
    latitude: state.latitude,
    longitude: state.longitude,
    altitude:
      128 +
      state.elapsedSeconds * 0.35 +
      Math.sin(state.elapsedSeconds / 10) * 4,
    speed,
    heading,
    accuracy: 6,
    timestamp: Date.now(),
  };
}

export function useGeolocation(
  options: UseGeolocationOptions = {}
): UseGeolocationResult {
  const {
    enableHighAccuracy = true,
    maximumAge = 1000,
    timeout = 10000,
    enableDevelopmentTestMode = false,
    onLocationChange,
  } = options;

  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [state, setState] = useState<GeolocationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidPointRef = useRef<GeoPoint | null>(null);
  const stateRef = useRef<GeolocationState>("idle");
  const simulationStateRef = useRef<SimulationState>({
    latitude: 50.631,
    longitude: 3.058,
    elapsedSeconds: 0,
  });

  const updateState = useCallback((nextState: GeolocationState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const clearActiveWatch = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      clearActiveWatch();
    }
    if (simulationIntervalRef.current !== null) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    updateState("idle");
    setError(null);
  }, [clearActiveWatch, updateState]);

  const requestPermission = useCallback(() => {
    if (
      watchIdRef.current !== null ||
      simulationIntervalRef.current !== null ||
      stateRef.current === "requesting"
    ) {
      return;
    }

    updateState("requesting");
    setError(null);

    if (enableDevelopmentTestMode && isDevelopmentTestRequest()) {
      const emitSimulatedPoint = () => {
        const simulatedPoint = generateSimulatedPosition(
          simulationStateRef.current
        );
        lastValidPointRef.current = simulatedPoint;
        setPoint(simulatedPoint);
        updateState("simulation");
        onLocationChange?.(simulatedPoint);
      };

      emitSimulatedPoint();
      simulationIntervalRef.current = setInterval(emitSimulatedPoint, 1000);
      return;
    }

    // Vérifier si la géolocalisation est disponible
    if (!navigator.geolocation) {
      updateState("unavailable");
      setError("Géolocalisation non disponible sur ce navigateur");
      return;
    }

    // Démarrer le suivi GPS réel
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, altitude, accuracy } =
          position.coords;
        const { speed, heading } = position.coords;

        const newPoint: GeoPoint = {
          latitude,
          longitude,
          altitude: altitude !== null ? altitude : null,
          speed: speed !== null ? speed * 3.6 : null, // Convertir m/s en km/h
          heading: heading !== null ? heading : null,
          accuracy: accuracy || null,
          timestamp: position.timestamp,
        };

        if (!isUsablePoint(newPoint, lastValidPointRef.current)) return;

        lastValidPointRef.current = newPoint;
        setPoint(newPoint);
        updateState("active");
        setError(null);

        onLocationChange?.(newPoint);
      },
      (err) => {
        clearActiveWatch();
        switch (err.code) {
          case err.PERMISSION_DENIED:
            updateState("permission_denied");
            setError("Permission de géolocalisation refusée");
            break;
          case err.POSITION_UNAVAILABLE:
            updateState("unavailable");
            setError("Position indisponible");
            break;
          case err.TIMEOUT:
            updateState("unavailable");
            setError("Timeout lors de la récupération de la position");
            break;
          default:
            updateState("error");
            setError("Erreur de géolocalisation");
        }

      },
      {
        enableHighAccuracy,
        maximumAge,
        timeout,
      }
    );
  }, [
    clearActiveWatch,
    enableDevelopmentTestMode,
    enableHighAccuracy,
    maximumAge,
    onLocationChange,
    timeout,
    updateState,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Cleanup au démontage
  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    point,
    state,
    error,
    isStale:
      point !== null && now > 0 && now - point.timestamp > STALE_POSITION_MS,
    positionAgeMs: point ? Math.max(0, now - point.timestamp) : null,
    requestPermission,
    stopTracking,
  };
}
