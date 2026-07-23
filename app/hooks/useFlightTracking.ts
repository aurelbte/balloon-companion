import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FlightMetrics,
  FlightSessionStatus,
  GeoPoint,
} from "../types/flight";
import { estimateVerticalSpeed } from "../lib/geo";
import {
  appendRecordedFlightPoint,
  calculateRecordedFlightSummary,
  createRecordedFlight,
  finalizeRecordedFlight,
  geoPointToRecordedFlightPoint,
  interruptRecordedFlight,
  recordedFlightPointToGeoPoint,
  recordedFlightSegmentDistance,
  resumeRecordedFlight,
  type RecordedFlight,
} from "../lib/recordedFlight";
import {
  IndexedDbRecordedFlightStorage,
  type RecordedFlightStorage,
} from "../lib/recordedFlightStorage";

interface UseFlightTrackingOptions {
  isEnabled?: boolean;
  storage?: RecordedFlightStorage;
}

interface UseFlightTrackingResult {
  status: FlightSessionStatus;
  isTracking: boolean;
  storageReady: boolean;
  storageError: string | null;
  points: GeoPoint[];
  metrics: FlightMetrics;
  activeFlight: RecordedFlight | null;
  recoverableFlight: RecordedFlight | null;
  completedFlight: RecordedFlight | null;
  markAcquiring: () => void;
  markReady: () => void;
  startTracking: (initialPoint?: GeoPoint | null) => void;
  stopTracking: () => Promise<RecordedFlight | null>;
  resumeInterruptedFlight: () => void;
  completeInterruptedFlight: () => Promise<RecordedFlight | null>;
  abandonInterruptedFlight: () => Promise<boolean>;
  dismissCompletedFlight: () => void;
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
const PERSIST_INTERVAL_MS = 5_000;

function metricsFromFlight(flight: RecordedFlight): FlightMetrics {
  const summary = calculateRecordedFlightSummary(
    flight.points,
    flight.startedAt,
    flight.endedAt,
  );
  const geoPoints = flight.points.map(recordedFlightPointToGeoPoint);
  const lastPoint = geoPoints.at(-1);
  return {
    altitude: lastPoint?.altitude ?? null,
    verticalSpeed: estimateVerticalSpeed(geoPoints, 5),
    groundSpeed: lastPoint?.speed ?? null,
    heading: lastPoint?.heading ?? null,
    durationSeconds: summary.durationSeconds,
    distanceKm: summary.distanceMeters / 1000,
    lastUpdated: lastPoint?.timestamp ?? flight.updatedAt,
  };
}

export function useFlightTracking(
  options: UseFlightTrackingOptions = {},
): UseFlightTrackingResult {
  const { isEnabled = true } = options;
  const storageRef = useRef<RecordedFlightStorage>(
    options.storage ?? new IndexedDbRecordedFlightStorage(),
  );
  const [status, setStatus] = useState<FlightSessionStatus>("ready");
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [metrics, setMetrics] = useState<FlightMetrics>(EMPTY_METRICS);
  const [activeFlight, setActiveFlight] = useState<RecordedFlight | null>(null);
  const [recoverableFlight, setRecoverableFlight] =
    useState<RecordedFlight | null>(null);
  const [completedFlight, setCompletedFlight] =
    useState<RecordedFlight | null>(null);

  const statusRef = useRef(status);
  const activeFlightRef = useRef<RecordedFlight | null>(null);
  const pointsRef = useRef<GeoPoint[]>([]);
  const metricsRef = useRef<FlightMetrics>(EMPTY_METRICS);
  const persistenceChainRef = useRef<Promise<void>>(Promise.resolve());

  const updateStatus = useCallback((nextStatus: FlightSessionStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const applyActiveFlight = useCallback(
    (flight: RecordedFlight, nextStatus: FlightSessionStatus = "recording") => {
      const geoPoints = flight.points.map(recordedFlightPointToGeoPoint);
      const nextMetrics = metricsFromFlight(flight);
      activeFlightRef.current = flight;
      pointsRef.current = geoPoints;
      metricsRef.current = nextMetrics;
      setActiveFlight(flight);
      setPoints(geoPoints);
      setMetrics(nextMetrics);
      updateStatus(nextStatus);
    },
    [updateStatus],
  );

  const queueActiveFlightPersistence = useCallback(
    (flight: RecordedFlight): Promise<void> => {
      const snapshot: RecordedFlight = {
        ...flight,
        points: [...flight.points],
        summary: calculateRecordedFlightSummary(
          flight.points,
          flight.startedAt,
          null,
        ),
        updatedAt: Date.now(),
      };
      persistenceChainRef.current = persistenceChainRef.current
        .catch(() => undefined)
        .then(() => storageRef.current.saveActiveFlight(snapshot))
        .then(() => setStorageError(null))
        .catch((error: unknown) => {
          console.error("Impossible de sauvegarder le vol actif", error);
          setStorageError("Enregistrement local temporairement indisponible");
        });
      return persistenceChainRef.current;
    },
    [],
  );

  const persistCurrentFlight = useCallback(() => {
    const flight = activeFlightRef.current;
    if (!flight || statusRef.current !== "recording") {
      return Promise.resolve();
    }
    return queueActiveFlightPersistence(flight);
  }, [queueActiveFlightPersistence]);

  useEffect(() => {
    let cancelled = false;
    void storageRef.current
      .getActiveFlight()
      .then(async (storedFlight) => {
        if (!storedFlight || storedFlight.status === "COMPLETED") return;
        const interrupted = interruptRecordedFlight(storedFlight);
        await storageRef.current.saveActiveFlight(interrupted);
        if (!cancelled) setRecoverableFlight(interrupted);
      })
      .catch((error: unknown) => {
        console.error("Impossible de lire le vol actif", error);
        if (!cancelled) {
          setStorageError("Stockage des vols indisponible");
        }
      })
      .finally(() => {
        if (!cancelled) setStorageReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markAcquiring = useCallback(() => {
    if (statusRef.current === "ready") updateStatus("acquiring");
  }, [updateStatus]);

  const markReady = useCallback(() => {
    if (statusRef.current === "acquiring") updateStatus("ready");
  }, [updateStatus]);

  const startTracking = useCallback(
    (initialPoint: GeoPoint | null = null) => {
      if (
        !isEnabled ||
        statusRef.current === "recording" ||
        recoverableFlight
      ) {
        return;
      }
      const now = Date.now();
      const firstPoint = initialPoint
        ? geoPointToRecordedFlightPoint(initialPoint)
        : null;
      const flight = createRecordedFlight({
        startedAt: now,
        firstPoint,
      });
      setCompletedFlight(null);
      applyActiveFlight(flight);
      void queueActiveFlightPersistence(flight);
    },
    [
      applyActiveFlight,
      isEnabled,
      queueActiveFlightPersistence,
      recoverableFlight,
    ],
  );

  const completeFlight = useCallback(
    async (flight: RecordedFlight): Promise<RecordedFlight | null> => {
      const completed = finalizeRecordedFlight(flight);
      try {
        await persistenceChainRef.current.catch(() => undefined);
        await storageRef.current.completeFlight(completed);
        activeFlightRef.current = null;
        setActiveFlight(null);
        setRecoverableFlight(null);
        setCompletedFlight(completed);
        updateStatus("stopped");
        setStorageError(null);
        return completed;
      } catch (error) {
        console.error("Impossible de finaliser le vol", error);
        setStorageError(
          "Le vol reste conservé comme actif. Réessayez avant de fermer.",
        );
        return null;
      }
    },
    [updateStatus],
  );

  const stopTracking = useCallback(async () => {
    const flight = activeFlightRef.current;
    if (!flight || statusRef.current !== "recording") return null;
    await persistCurrentFlight();
    return completeFlight(flight);
  }, [completeFlight, persistCurrentFlight]);

  const resumeInterruptedFlight = useCallback(() => {
    if (!recoverableFlight) return;
    const resumed = resumeRecordedFlight(recoverableFlight);
    setRecoverableFlight(null);
    applyActiveFlight(resumed);
    void queueActiveFlightPersistence(resumed);
  }, [
    applyActiveFlight,
    queueActiveFlightPersistence,
    recoverableFlight,
  ]);

  const completeInterruptedFlight = useCallback(async () => {
    if (!recoverableFlight) return null;
    return completeFlight(recoverableFlight);
  }, [completeFlight, recoverableFlight]);

  const abandonInterruptedFlight = useCallback(async () => {
    if (!recoverableFlight) return true;
    try {
      await storageRef.current.clearActiveFlight();
      setRecoverableFlight(null);
      setStorageError(null);
      return true;
    } catch (error) {
      console.error("Impossible d’abandonner le vol actif", error);
      setStorageError("Impossible de supprimer le vol actif");
      return false;
    }
  }, [recoverableFlight]);

  const dismissCompletedFlight = useCallback(() => {
    setCompletedFlight(null);
    pointsRef.current = [];
    metricsRef.current = EMPTY_METRICS;
    setPoints([]);
    setMetrics(EMPTY_METRICS);
    updateStatus("ready");
  }, [updateStatus]);

  const addPoint = useCallback((point: GeoPoint) => {
    const flight = activeFlightRef.current;
    if (!flight || statusRef.current !== "recording") return;

    const recordedPoint = geoPointToRecordedFlightPoint(point);
    const result = appendRecordedFlightPoint(flight, recordedPoint);
    if (!result.acceptance.accepted) return;

    const previousRecordedPoint = flight.points.at(-1);
    const nextFlight = result.flight;
    const nextPoints = [...pointsRef.current, point];
    const nextMetrics: FlightMetrics = {
      ...metricsRef.current,
      altitude: point.altitude,
      verticalSpeed: estimateVerticalSpeed(nextPoints, 5),
      groundSpeed: point.speed,
      heading: point.heading,
      distanceKm:
        metricsRef.current.distanceKm +
        (previousRecordedPoint
          ? recordedFlightSegmentDistance(
              previousRecordedPoint,
              recordedPoint,
            ) / 1000
          : 0),
      lastUpdated: point.timestamp,
    };
    activeFlightRef.current = nextFlight;
    pointsRef.current = nextPoints;
    metricsRef.current = nextMetrics;
    setActiveFlight(nextFlight);
    setPoints(nextPoints);
    setMetrics(nextMetrics);
  }, []);

  useEffect(() => {
    if (status !== "recording" || !activeFlightRef.current) return;
    const updateDuration = () => {
      const flight = activeFlightRef.current;
      if (!flight) return;
      const nextMetrics = {
        ...metricsRef.current,
        durationSeconds: Math.max(0, (Date.now() - flight.startedAt) / 1000),
      };
      metricsRef.current = nextMetrics;
      setMetrics(nextMetrics);
    };
    updateDuration();
    const intervalId = window.setInterval(updateDuration, 1_000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void persistCurrentFlight();
    }, PERSIST_INTERVAL_MS);
    const forcePersistence = () => {
      void persistCurrentFlight();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") forcePersistence();
    };
    window.addEventListener("pagehide", forcePersistence);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", forcePersistence);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      forcePersistence();
    };
  }, [persistCurrentFlight]);

  return {
    status,
    isTracking: status === "recording",
    storageReady,
    storageError,
    points,
    metrics,
    activeFlight,
    recoverableFlight,
    completedFlight,
    markAcquiring,
    markReady,
    startTracking,
    stopTracking,
    resumeInterruptedFlight,
    completeInterruptedFlight,
    abandonInterruptedFlight,
    dismissCompletedFlight,
    addPoint,
  };
}
