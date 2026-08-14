import type { GeoPoint } from "../types/flight.ts";
import type { ExportedPlannedTrajectory } from "./trajectory/weatherAnalysisStorage.ts";

export const GROUND_CALIBRATION_FIX_COUNT = 5;
export const TERRAIN_REFRESH_DISTANCE_METERS = 130;
export const MAX_TERRAIN_PRELOAD_CELLS = 100;
export const MAX_USABLE_VERTICAL_ACCURACY_METERS = 100;
const MAX_CALIBRATION_SPREAD_METERS = 25;
const MAX_CALIBRATION_DISPLACEMENT_METERS = 35;
const TERRAIN_DB_NAME = "balloon-companion-terrain-cache-v1";
const TERRAIN_STORE = "cells";

export type TerrainCell = { id: string; latitude: number; longitude: number; elevationMeters: number; source: string; fetchedAt: string };
export type GroundCalibration = { version: 1; offsetMeters: number; departureTerrainElevationMeters: number; calibratedAt: number; fixCount: number };

export function terrainCellFor(latitude: number, longitude: number): Pick<TerrainCell, "id" | "latitude" | "longitude"> {
  const representativeLatitude = Math.round(latitude * 1000) / 1000;
  const representativeLongitude = Math.round(longitude * 1000) / 1000;
  return { id: `${representativeLatitude.toFixed(3)},${representativeLongitude.toFixed(3)}`, latitude: representativeLatitude, longitude: representativeLongitude };
}

export function distanceMeters(a: Pick<GeoPoint, "latitude" | "longitude">, b: Pick<GeoPoint, "latitude" | "longitude">): number {
  const lat = (a.latitude + b.latitude) / 2 * Math.PI / 180;
  return Math.hypot((a.latitude - b.latitude) * 111_320, (a.longitude - b.longitude) * 111_320 * Math.cos(lat));
}

export function usableAltitudeFix(point: GeoPoint | null): point is GeoPoint & { altitude: number; verticalAccuracy: number } {
  return Boolean(point && Number.isFinite(point.altitude) && Number.isFinite(point.verticalAccuracy) && point.verticalAccuracy! >= 0 && point.verticalAccuracy! <= MAX_USABLE_VERTICAL_ACCURACY_METERS);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function createGroundCalibration(fixes: readonly GeoPoint[], departureTerrainElevationMeters: number, now = Date.now()): GroundCalibration | null {
  const usable = fixes.filter(usableAltitudeFix).slice(-GROUND_CALIBRATION_FIX_COUNT);
  if (usable.length < GROUND_CALIBRATION_FIX_COUNT || !Number.isFinite(departureTerrainElevationMeters)) return null;
  const altitudes = usable.map(({ altitude }) => altitude);
  if (Math.max(...altitudes) - Math.min(...altitudes) > MAX_CALIBRATION_SPREAD_METERS) return null;
  if (usable.some((point) => distanceMeters(usable[0], point) > MAX_CALIBRATION_DISPLACEMENT_METERS)) return null;
  return { version: 1, offsetMeters: median(altitudes) - departureTerrainElevationMeters, departureTerrainElevationMeters, calibratedAt: now, fixCount: usable.length };
}

export function estimateGroundMeters(recentFixes: readonly GeoPoint[], calibration: GroundCalibration | null, terrainElevationMeters: number | null): number | null {
  if (!calibration || terrainElevationMeters === null || !Number.isFinite(terrainElevationMeters)) return null;
  const altitudes = recentFixes.filter(usableAltitudeFix).slice(-3).map(({ altitude }) => altitude);
  if (altitudes.length < 3) return null;
  const correctedAltitude = median(altitudes) - calibration.offsetMeters + calibration.departureTerrainElevationMeters;
  const ground = correctedAltitude - terrainElevationMeters;
  return Number.isFinite(ground) && ground >= -20 && ground <= 10_000 ? ground : null;
}

function openTerrainDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TERRAIN_DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(TERRAIN_STORE)) request.result.createObjectStore(TERRAIN_STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readTerrainCell(id: string): Promise<TerrainCell | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openTerrainDb();
  return new Promise((resolve, reject) => { const request = db.transaction(TERRAIN_STORE).objectStore(TERRAIN_STORE).get(id); request.onsuccess = () => resolve((request.result as TerrainCell | undefined) ?? null); request.onerror = () => reject(request.error); });
}

export async function writeTerrainCells(cells: readonly TerrainCell[]): Promise<void> {
  if (typeof indexedDB === "undefined" || cells.length === 0) return;
  const db = await openTerrainDb();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction(TERRAIN_STORE, "readwrite"); for (const cell of cells) transaction.objectStore(TERRAIN_STORE).put(cell); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
}

export async function loadTerrainCell(latitude: number, longitude: number, signal?: AbortSignal): Promise<{ cell: TerrainCell | null; source: "cache" | "network" | "unavailable" }> {
  const spatial = terrainCellFor(latitude, longitude);
  return loadTerrainCellWithAccess(spatial, signal);
}

export async function loadTerrainCellWithAccess(
  spatial: Pick<TerrainCell, "id" | "latitude" | "longitude">,
  signal?: AbortSignal,
  access: {
    read(id: string): Promise<TerrainCell | null>;
    write(cells: readonly TerrainCell[]): Promise<void>;
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  } = { read: readTerrainCell, write: writeTerrainCells, fetch },
): Promise<{ cell: TerrainCell | null; source: "cache" | "network" | "unavailable" }> {
  const cached = await access.read(spatial.id).catch(() => null);
  if (cached) return { cell: cached, source: "cache" };
  try {
    const response = await access.fetch(`/api/elevation?lat=${spatial.latitude}&lon=${spatial.longitude}`, { signal });
    const payload = await response.json() as { data?: { elevationAmslM?: number }; provider?: string };
    const elevationMeters = payload.data?.elevationAmslM;
    if (!response.ok || !Number.isFinite(elevationMeters)) return { cell: null, source: "unavailable" };
    const cell: TerrainCell = { ...spatial, elevationMeters: elevationMeters!, source: payload.provider ?? "Open-Meteo", fetchedAt: new Date().toISOString() };
    await access.write([cell]).catch(() => undefined);
    return { cell, source: "network" };
  } catch { return { cell: null, source: "unavailable" }; }
}

export function terrainPreloadCells(trajectories: readonly ExportedPlannedTrajectory[]): Array<Pick<TerrainCell, "id" | "latitude" | "longitude">> {
  const cells = new Map<string, Pick<TerrainCell, "id" | "latitude" | "longitude">>();
  for (const trajectory of trajectories) {
    let previous: { latitude: number; longitude: number } | null = null;
    for (const [longitude, latitude] of trajectory.geometry) {
      const point = { latitude, longitude };
      if (previous && distanceMeters(previous, point) < 130) continue;
      previous = point;
      const latitudeOffset = 100 / 111_320;
      for (const candidate of [point, { latitude: latitude + latitudeOffset, longitude }, { latitude: latitude - latitudeOffset, longitude }]) {
        const cell = terrainCellFor(candidate.latitude, candidate.longitude);
        cells.set(cell.id, cell);
        if (cells.size >= MAX_TERRAIN_PRELOAD_CELLS) return [...cells.values()];
      }
    }
  }
  return [...cells.values()];
}

export async function preloadTerrainCells(trajectories: readonly ExportedPlannedTrajectory[], signal?: AbortSignal): Promise<void> {
  const candidates = terrainPreloadCells(trajectories);
  const missing: typeof candidates = [];
  for (const cell of candidates) if (!await readTerrainCell(cell.id).catch(() => null)) missing.push(cell);
  if (missing.length === 0) return;
  try {
    const response = await fetch("/api/elevation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points: missing }), signal });
    const payload = await response.json() as { data?: Array<{ latitude: number; longitude: number; elevationAmslM: number }>; provider?: string };
    if (!response.ok || !Array.isArray(payload.data)) return;
    const now = new Date().toISOString();
    await writeTerrainCells(payload.data.flatMap((item) => Number.isFinite(item.elevationAmslM) ? [{ ...terrainCellFor(item.latitude, item.longitude), elevationMeters: item.elevationAmslM, source: payload.provider ?? "Open-Meteo", fetchedAt: now }] : [])).catch(() => undefined);
  } catch { /* Préchargement facultatif et silencieux. */ }
}
