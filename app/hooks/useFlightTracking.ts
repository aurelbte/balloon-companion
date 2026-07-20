/**
 * Hook pour gérer l'état du suivi de vol
 * Accumule les points GPS et calcule les métriques
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoPoint, FlightMetrics } from "../types/flight";
import {
  calculateTotalDistance,
  estimateVerticalSpeed,
} from "../lib/geo";

interface UseFlightTrackingOptions {
  isEnabled?: boolean;
}

interface UseFlightTrackingResult {
  isTracking: boolean;
  points: GeoPoint[];
  metrics: FlightMetrics;
  startTracking: () => void;
  stopTracking: () => void;
  addPoint: (point: GeoPoint) => void;
  reset: () => void;
}

export function useFlightTracking(
  options: UseFlightTrackingOptions = {}
): UseFlightTrackingResult {
  const { isEnabled = true } = options;

  const [isTracking, setIsTracking] = useState(false);
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [metrics, setMetrics] = useState<FlightMetrics>({
    altitude: null,
    verticalSpeed: null,
    groundSpeed: null,
    heading: null,
    durationSeconds: 0,
    distanceKm: 0,
    lastUpdated: 0,
  });

  const startTimeRef = useRef<number | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startTracking = useCallback(() => {
    if (!isEnabled) return;

    setIsTracking(true);
    setPoints([]);
    setMetrics({
      altitude: null,
      verticalSpeed: null,
      groundSpeed: null,
      heading: null,
      durationSeconds: 0,
      distanceKm: 0,
      lastUpdated: 0,
    });

    startTimeRef.current = Date.now();

    // Mettre à jour les métriques de durée toutes les secondes
    updateIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const durationSeconds = (Date.now() - startTimeRef.current) / 1000;
        setMetrics((prev) => ({
          ...prev,
          durationSeconds,
        }));
      }
    }, 1000);
  }, [isEnabled]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  const addPoint = useCallback((point: GeoPoint) => {
    setPoints((prevPoints) => {
      const newPoints = [...prevPoints, point];

      // Calculer les métriques mises à jour
      const lastPoint = newPoints[newPoints.length - 1];
      const altitude = lastPoint.altitude;
      const groundSpeed = lastPoint.speed || 0;
      const heading = lastPoint.heading;

      // Calculer la vitesse verticale
      const vario = estimateVerticalSpeed(newPoints, 5);

      // Calculer la distance totale
      const distanceKm = calculateTotalDistance(newPoints);

      setMetrics((prev) => ({
        ...prev,
        altitude,
        verticalSpeed: vario,
        groundSpeed,
        heading,
        distanceKm,
        lastUpdated: Date.now(),
      }));

      return newPoints;
    });
  }, []);

  const reset = useCallback(() => {
    stopTracking();
    setPoints([]);
    setMetrics({
      altitude: null,
      verticalSpeed: null,
      groundSpeed: null,
      heading: null,
      durationSeconds: 0,
      distanceKm: 0,
      lastUpdated: 0,
    });
  }, [stopTracking]);

  // Cleanup au démontage
  useEffect(() => {
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, []);

  return {
    isTracking,
    points,
    metrics,
    startTracking,
    stopTracking,
    addPoint,
    reset,
  };
}
