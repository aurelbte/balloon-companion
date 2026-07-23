import type {
  FlightMetrics,
  FlightSessionStatus,
  GeoPoint,
  PersistedFlightSession,
} from "../types/flight";

const STORAGE_KEY = "balloon_companion_flight_session";
const STORAGE_VERSION = 1;

const SESSION_STATUSES: FlightSessionStatus[] = [
  "ready",
  "acquiring",
  "recording",
  "stopped",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isGeoPoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GeoPoint>;

  return (
    isFiniteNumber(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    isFiniteNumber(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    isNullableFiniteNumber(point.altitude) &&
    isNullableFiniteNumber(point.speed) &&
    isNullableFiniteNumber(point.heading) &&
    isNullableFiniteNumber(point.accuracy) &&
    (point.verticalAccuracy === undefined ||
      isNullableFiniteNumber(point.verticalAccuracy)) &&
    isFiniteNumber(point.timestamp)
  );
}

function isMetrics(value: unknown): value is FlightMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Partial<FlightMetrics>;

  return (
    isNullableFiniteNumber(metrics.altitude) &&
    isNullableFiniteNumber(metrics.verticalSpeed) &&
    isNullableFiniteNumber(metrics.groundSpeed) &&
    isNullableFiniteNumber(metrics.heading) &&
    isFiniteNumber(metrics.durationSeconds) &&
    metrics.durationSeconds >= 0 &&
    isFiniteNumber(metrics.distanceKm) &&
    metrics.distanceKm >= 0 &&
    isFiniteNumber(metrics.lastUpdated)
  );
}

export function loadFlightSession(): PersistedFlightSession | null {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) return null;

    const value = JSON.parse(serialized) as Partial<PersistedFlightSession>;
    if (
      value.version !== STORAGE_VERSION ||
      !SESSION_STATUSES.includes(value.status as FlightSessionStatus) ||
      !isNullableFiniteNumber(value.startTime) ||
      !Array.isArray(value.points) ||
      !value.points.every(isGeoPoint) ||
      !isMetrics(value.metrics) ||
      !isFiniteNumber(value.savedAt)
    ) {
      return null;
    }

    return value as PersistedFlightSession;
  } catch {
    return null;
  }
}

export function saveFlightSession(
  session: Omit<PersistedFlightSession, "version" | "savedAt">
): boolean {
  try {
    const persisted: PersistedFlightSession = {
      ...session,
      version: STORAGE_VERSION,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    return true;
  } catch (error) {
    console.error("Impossible de sauvegarder la session de vol", error);
    return false;
  }
}
