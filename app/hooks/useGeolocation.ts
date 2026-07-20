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
  simulateIfUnavailable?: boolean;
  onLocationChange?: (point: GeoPoint) => void;
}

interface UseGeolocationResult {
  point: GeoPoint | null;
  state: GeolocationState;
  error: string | null;
  requestPermission: () => void;
  stopTracking: () => void;
}

/**
 * Générer une position simulée à partir d'une position de base
 * Utilisé uniquement en développement quand la géolocalisation n'est pas disponible
 */
function generateSimulatedPosition(): GeoPoint {
  const baseLatitude = 50.631;
  const baseLongitude = 3.058;

  const drift = 0.0001; // ~11 mètres
  const randomLat = baseLatitude + (Math.random() - 0.5) * drift * 2;
  const randomLon = baseLongitude + (Math.random() - 0.5) * drift * 2;
  const randomAltitude = 100 + Math.random() * 50;
  const randomSpeed = Math.random() * 15 + 5;
  const randomHeading = Math.random() * 360;

  return {
    latitude: randomLat,
    longitude: randomLon,
    altitude: randomAltitude,
    speed: randomSpeed,
    heading: randomHeading,
    accuracy: 5,
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
    simulateIfUnavailable = process.env.NODE_ENV === "development",
    onLocationChange,
  } = options;

  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [state, setState] = useState<GeolocationState>("idle");
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (simulationIntervalRef.current !== null) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
    setState("idle");
    setError(null);
  }, []);

  const requestPermission = useCallback(() => {
    if (state === "active" || state === "requesting") {
      return;
    }

    setState("requesting");
    setError(null);

    // Vérifier si la géolocalisation est disponible
    if (!navigator.geolocation) {
      if (simulateIfUnavailable) {
        setState("simulation");
        // Lancer la simulation
        simulationIntervalRef.current = setInterval(() => {
          const simPoint = generateSimulatedPosition();
          setPoint(simPoint);
          onLocationChange?.(simPoint);
        }, 2000);
      } else {
        setState("unavailable");
        setError("Géolocalisation non disponible sur ce navigateur");
      }
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

        setPoint(newPoint);
        setState("active");
        setError(null);

        onLocationChange?.(newPoint);
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setState("permission_denied");
            setError("Permission de géolocalisation refusée");
            break;
          case err.POSITION_UNAVAILABLE:
            setState("unavailable");
            setError("Position indisponible");
            break;
          case err.TIMEOUT:
            setError("Timeout lors de la récupération de la position");
            break;
          default:
            setError("Erreur de géolocalisation");
        }

        // Basculer vers simulation si activée
        if (simulateIfUnavailable) {
          setState("simulation");
          simulationIntervalRef.current = setInterval(() => {
            const simPoint = generateSimulatedPosition();
            setPoint(simPoint);
            onLocationChange?.(simPoint);
          }, 2000);
        }
      },
      {
        enableHighAccuracy,
        maximumAge,
        timeout,
      }
    );
  }, [state, simulateIfUnavailable, point, onLocationChange, enableHighAccuracy, maximumAge, timeout]);

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
    requestPermission,
    stopTracking,
  };
}
