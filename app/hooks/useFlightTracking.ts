import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FlightMetrics,
  FlightSessionStatus,
  GeoPoint,
} from "../types/flight";
import { calculateDistance, estimateVerticalSpeed } from "../lib/geo";
import {
  loadFlightSession,
  saveFlightSession,
} from "../lib/flightSessionStorage";

interface UseFlightTrackingOptions {
  isEnabled?: boolean;
}

interface UseFlightTrackingResult {
  status: FlightSessionStatus;
  isTracking: boolean;
  points: GeoPoint[];
  metrics: FlightMetrics;
  hasSavedFlight: boolean;
  markAcquiring: () => void;
  markReady: () => void;
  startTracking: () => void;
  stopTracking: () => void;
  addPoint: (point: GeoPoint) => void;
}

const EMPTY_METRICS: FlightMetrics = {
  altitude: null,
  verticalSpeed: null,
  groundSpeed: null,
  heading: null,
  durationSeconds: 0,
  distanceKm: 0,
  lastUpdated: 0,
};

const MIN_MOVING_SPEED_KMH = 1.5;
const MIN_DISTANCE_INCREMENT_METERS = 8;

export function useFlightTracking(
  options: UseFlightTrackingOptions = {}
): UseFlightTrackingResult {
  const { isEnabled = true } = options;
  const [status, setStatus] = useState<FlightSessionStatus>("ready");
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [metrics, setMetrics] = useState<FlightMetrics>(EMPTY_METRICS);

  const startTimeRef = useRef<number | null>(null);
  const statusRef = useRef(status);
  const pointsRef = useRef(points);
  const metricsRef = useRef(metrics);
  const storageReadyRef = useRef(false);

  const updateStatus = useCallback((nextStatus: FlightSessionStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const persist = useCallback(() => {
    if (!storageReadyRef.current) return;
    saveFlightSession({
      status: statusRef.current,
      startTime: startTimeRef.current,
      points: pointsRef.current,
      metrics: metricsRef.current,
    });
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const restored = loadFlightSession();
      storageReadyRef.current = true;
      if (!restored) return;

      startTimeRef.current = restored.startTime;
      statusRef.current = restored.status;
      pointsRef.current = restored.points;
      metricsRef.current = restored.metrics;
      setStatus(restored.status);
      setPoints(restored.points);
      setMetrics(restored.metrics);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const markAcquiring = useCallback(() => {
    if (statusRef.current === "ready") updateStatus("acquiring");
  }, [updateStatus]);

  const markReady = useCallback(() => {
    if (statusRef.current === "acquiring") updateStatus("ready");
  }, [updateStatus]);

  const startTracking = useCallback(() => {
    if (!isEnabled || statusRef.current === "recording") return;

    const nextMetrics = { ...EMPTY_METRICS };
    startTimeRef.current = Date.now();
    pointsRef.current = [];
    metricsRef.current = nextMetrics;
    setPoints([]);
    setMetrics(nextMetrics);
    updateStatus("recording");
    persist();
  }, [isEnabled, persist, updateStatus]);

  const stopTracking = useCallback(() => {
    if (statusRef.current !== "recording") return;
    updateStatus("stopped");
    persist();
  }, [persist, updateStatus]);

  const addPoint = useCallback((point: GeoPoint) => {
    if (statusRef.current !== "recording") return;

    const previousPoint = pointsRef.current.at(-1);
    const nextPoints = [...pointsRef.current, point];
    let distanceKm = metricsRef.current.distanceKm;

    if (previousPoint) {
      const segmentKm = calculateDistance(
        previousPoint.latitude,
        previousPoint.longitude,
        point.latitude,
        point.longitude
      );
      const accuracyNoiseMeters = Math.max(
        previousPoint.accuracy ?? 0,
        point.accuracy ?? 0,
        MIN_DISTANCE_INCREMENT_METERS
      );

      // À très faible vitesse, un déplacement inférieur à la précision GPS est
      // considéré comme de la dérive et ne gonfle pas la distance parcourue.
      if (
        (point.speed ?? 0) >= MIN_MOVING_SPEED_KMH &&
        segmentKm * 1000 > accuracyNoiseMeters
      ) {
        distanceKm += segmentKm;
      }
    }

    const nextMetrics: FlightMetrics = {
      ...metricsRef.current,
      altitude:
        point.altitude !== null && Number.isFinite(point.altitude)
          ? point.altitude
          : null,
      verticalSpeed: estimateVerticalSpeed(nextPoints, 5),
      groundSpeed:
        point.speed !== null && Number.isFinite(point.speed)
          ? point.speed
          : null,
      heading:
        point.heading !== null && Number.isFinite(point.heading)
          ? point.heading
          : null,
      distanceKm,
      lastUpdated: point.timestamp,
    };

    pointsRef.current = nextPoints;
    metricsRef.current = nextMetrics;
    setPoints(nextPoints);
    setMetrics(nextMetrics);
  }, []);

  useEffect(() => {
    if (status !== "recording" || startTimeRef.current === null) return;

    const updateDuration = () => {
      const startTime = startTimeRef.current;
      if (startTime === null) return;
      const nextMetrics = {
        ...metricsRef.current,
        durationSeconds: Math.max(0, (Date.now() - startTime) / 1000),
      };
      metricsRef.current = nextMetrics;
      setMetrics(nextMetrics);
    };

    updateDuration();
    const intervalId = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (statusRef.current === "recording") persist();
    }, 5000);
    const handlePageHide = () => persist();
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", handlePageHide);
      persist();
    };
  }, [persist]);

  return {
    status,
    isTracking: status === "recording",
    points,
    metrics,
    hasSavedFlight: points.length > 0,
    markAcquiring,
    markReady,
    startTracking,
    stopTracking,
    addPoint,
  };
}
