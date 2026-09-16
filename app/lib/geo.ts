/**
 * Utilités géographiques et géodésiques
 * Pour les calculs de distance, cap, projection, etc.
 */

import type { GeoPoint, ProjectionPoint } from "../types/flight";

const EARTH_RADIUS_KM = 6371;

/**
 * Convertir degrés en radians
 */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Convertir radians en degrés
 */
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Calculer la distance (en km) entre deux points GPS (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_KM * c;

  return distance;
}

/**
 * Calculer le cap (bearing) entre deux points GPS
 * Retourne un angle en degrés (0-360)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = Math.atan2(y, x);

  return (toDeg(bearing) + 360) % 360;
}

/**
 * Calculer le point de destination à partir d'une position initiale,
 * d'une distance et d'un cap
 */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceKm: number,
  bearing: number
): [number, number] {
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const θ = toRad(bearing);
  const δ = distanceKm / EARTH_RADIUS_KM;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );

  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return [toDeg(λ2), toDeg(φ2)];
}

/**
 * Construire les points de projection GPS
 * Calcule les positions à 5, 10, 20, 30, 60 minutes
 */
export function buildGpsProjectionPoints(
  lat: number,
  lon: number,
  bearing: number,
  speedKmh: number
): ProjectionPoint[] {
  if (speedKmh <= 0 || !isFinite(bearing)) {
    return [];
  }

  const intervals = [5, 10, 20, 30, 60];
  const points: ProjectionPoint[] = [];

  intervals.forEach((minutes) => {
    const distanceKm = (speedKmh * minutes) / 60;
    const [projLon, projLat] = destinationPoint(lat, lon, distanceKm, bearing);

    points.push({
      minutes,
      latitude: projLat,
      longitude: projLon,
    });
  });

  return points;
}

/**
 * Calculer la distance parcourue cumulée à partir d'une liste de points
 */
export function calculateTotalDistance(points: GeoPoint[]): number {
  if (points.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segmentDistance = calculateDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );
    totalDistance += segmentDistance;
  }

  return totalDistance;
}

/**
 * Estimer la vitesse verticale à partir d'une liste de points
 * Utilise une fenêtre glissante pour lisser les valeurs
 */
export function estimateVerticalSpeed(
  points: GeoPoint[],
  windowSize: number = 3
): number | null {
  if (points.length < 2) return null;

  // Conserver la fenêtre et le calcul existants. Seule l'admissibilité change.
  // Une incertitude verticale > 25 m est trop dégradée pour une pente sur quelques fixes.
  // 8 s : même rupture que flightSegments ; 10 m/s : pic non confirmé de gpsPointQuality.
  const recentPoints = points.slice(-Math.max(windowSize, 2));
  let validPoints: Array<GeoPoint & { altitude: number }> = [];
  for (let index = 0; index < recentPoints.length; index++) {
    const point = recentPoints[index];
    if (point.altitude === null || !Number.isFinite(point.altitude) || !Number.isFinite(point.timestamp) ||
        point.verticalAccuracy === null || !Number.isFinite(point.verticalAccuracy) ||
        point.verticalAccuracy < 0 || point.verticalAccuracy > 25 ||
        (point.quality !== undefined && point.quality !== "VALID") ||
        point.firstFixAfterResume || point.appState === "RESUME" ||
        (point.qualityReason !== undefined && point.qualityReason !== "NONE")) {
      validPoints = [];
      continue;
    }
    const previous = recentPoints[index - 1];
    if (previous) {
      const delta = point.timestamp - previous.timestamp;
      if (delta <= 0) { validPoints = []; continue; }
      if (delta >= 8_000 || (point.deltaTimeSincePreviousPoint ?? 0) >= 8_000 ||
          (point.segmentId !== undefined && previous.segmentId !== undefined && point.segmentId !== previous.segmentId)) {
        validPoints = [];
      } else if (point.quality === undefined && (previous.quality === undefined || previous.quality === "VALID") &&
          previous.altitude !== null && Number.isFinite(previous.altitude) &&
          Math.abs((point.altitude - previous.altitude) / (delta / 1_000)) > 10) {
        // Ne pas diluer un pic non confirmé dans une pente apparemment crédible.
        validPoints = [];
        continue;
      }
    }
    validPoints.push(point as GeoPoint & { altitude: number });
  }
  if (validPoints.length < 2) return null;
  const first = validPoints[0];
  const last = validPoints[validPoints.length - 1];
  const timeDiffSeconds = (last.timestamp - first.timestamp) / 1_000;
  if (timeDiffSeconds <= 0) return null;
  const rate = (last.altitude - first.altitude) / timeDiffSeconds;
  return Number.isFinite(rate) ? rate : null;
}

/**
 * Formater la durée en HH:MM ou MM:SS
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "—";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Normaliser un cap (heading) à la plage 0-360
 */
export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/**
 * Formater une altitude
 */
export function formatAltitude(altitude: number | null): string {
  if (altitude === null || !isFinite(altitude)) return "—";
  return `${Math.round(altitude)} m`;
}

/**
 * Formater une vitesse verticale
 */
export function formatVerticalSpeed(vario: number | null): string {
  if (vario === null || !isFinite(vario)) return "—";
  const sign = vario >= 0 ? "+" : "";
  return `${sign}${vario.toFixed(1)} m/s`;
}

/**
 * Formater une vitesse sol
 */
export function formatGroundSpeed(speed: number | null): string {
  if (speed === null || !isFinite(speed)) return "—";
  return `${Math.round(speed)} km/h`;
}

/**
 * Formater une distance
 */
export function formatDistance(distance: number): string {
  if (!isFinite(distance)) return "—";
  return `${distance.toFixed(1)} km`;
}

/**
 * Formater un cap
 */
export function formatHeading(heading: number | null): string {
  if (heading === null || !isFinite(heading)) return "—";
  return `${Math.round(normalizeHeading(heading))}°`;
}
