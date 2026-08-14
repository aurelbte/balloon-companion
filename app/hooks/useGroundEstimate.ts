"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoPoint } from "../types/flight";
import type { RecordedFlight } from "../lib/recordedFlight";
import type { ExportedPlannedTrajectory } from "../lib/trajectory/weatherAnalysisStorage";
import {
  createGroundCalibration,
  distanceMeters,
  estimateGroundMeters,
  loadTerrainCell,
  preloadTerrainCells,
  TERRAIN_REFRESH_DISTANCE_METERS,
  usableAltitudeFix,
  type GroundCalibration,
  type TerrainCell,
} from "../lib/groundElevation";

export function useGroundEstimate({ point, isStale, isTracking, activeFlight, trajectories, onCalibration }: { point: GeoPoint | null; isStale: boolean; isTracking: boolean; activeFlight: RecordedFlight | null; trajectories: readonly ExportedPlannedTrajectory[]; onCalibration(calibration: GroundCalibration): void }) {
  const [terrain, setTerrain] = useState<TerrainCell | null>(null);
  const [departureTerrain, setDepartureTerrain] = useState<number | null>(null);
  const [recentFixes, setRecentFixes] = useState<GeoPoint[]>([]);
  const calibrationFixesRef = useRef<GeoPoint[]>([]);
  const departurePointRef = useRef<GeoPoint | null>(null);
  const terrainRequestPointRef = useRef<GeoPoint | null>(null);
  const flightIdRef = useRef<string | null>(null);
  const preloadKeyRef = useRef("");
  const calibration = activeFlight?.groundCalibration ?? null;

  useEffect(() => {
    const key = trajectories.map(({ traceId }) => traceId).join("|");
    if (!key || preloadKeyRef.current === key) return;
    preloadKeyRef.current = key;
    const controller = new AbortController();
    void preloadTerrainCells(trajectories, controller.signal);
    return () => controller.abort();
  }, [trajectories]);

  useEffect(() => {
    const flightId = activeFlight?.id ?? null;
    if (flightIdRef.current === flightId) return;
    flightIdRef.current = flightId;
    calibrationFixesRef.current = [];
    departurePointRef.current = null;
    terrainRequestPointRef.current = null;
    setRecentFixes([]);
    setTerrain(null);
    setDepartureTerrain(null);
  }, [activeFlight?.id]);

  useEffect(() => {
    if (calibration) setDepartureTerrain(calibration.departureTerrainElevationMeters);
  }, [calibration]);

  useEffect(() => {
    if (!isTracking || isStale || !usableAltitudeFix(point)) return;
    setRecentFixes((current) => [...current.filter(({ timestamp }) => timestamp !== point.timestamp), point].slice(-5));
    if (!calibration) {
      departurePointRef.current ??= point;
      calibrationFixesRef.current = [...calibrationFixesRef.current.filter(({ timestamp }) => timestamp !== point.timestamp), point].slice(-8);
    }
    const lastRequest = terrainRequestPointRef.current;
    if (lastRequest && distanceMeters(lastRequest, point) < TERRAIN_REFRESH_DISTANCE_METERS) return;
    terrainRequestPointRef.current = point;
    setTerrain(null);
    const requestedFlightId = activeFlight?.id;
    void loadTerrainCell(point.latitude, point.longitude).then(({ cell }) => {
      if (flightIdRef.current !== requestedFlightId) return;
      setTerrain(cell);
      if (departureTerrain === null && departurePointRef.current && distanceMeters(departurePointRef.current, point) < TERRAIN_REFRESH_DISTANCE_METERS) setDepartureTerrain(cell?.elevationMeters ?? null);
    });
  }, [activeFlight?.id, calibration, departureTerrain, isStale, isTracking, point]);

  useEffect(() => {
    if (calibration || departureTerrain === null) return;
    const next = createGroundCalibration(calibrationFixesRef.current, departureTerrain);
    if (next) onCalibration(next);
  }, [calibration, departureTerrain, onCalibration, recentFixes]);

  const groundMeters = useMemo(() => isTracking && !isStale && usableAltitudeFix(point)
    ? estimateGroundMeters(recentFixes, calibration, terrain?.elevationMeters ?? null)
    : null, [calibration, isStale, isTracking, point, recentFixes, terrain?.elevationMeters]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || typeof window === "undefined" || new URLSearchParams(window.location.search).get("debugGps") !== "1") return;
    console.debug("[ground-estimate]", { rawAltitude: point?.altitude ?? null, altitudeAccuracy: point?.verticalAccuracy ?? null, departureDem: calibration?.departureTerrainElevationMeters ?? departureTerrain, calibrationOffset: calibration?.offsetMeters ?? null, currentDem: terrain?.elevationMeters ?? null, terrainCell: terrain?.id ?? null, groundMeters, calibrationState: calibration ? "CALIBRATED" : "PENDING" });
  }, [calibration, departureTerrain, groundMeters, point?.altitude, point?.verticalAccuracy, terrain]);

  return { groundMeters, calibration, terrain };
}
