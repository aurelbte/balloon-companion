/**
 * Types for Flight Mode
 * Gère tous les types liés au suivi en vol réel
 */

/**
 * Position GPS unique
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  verticalAccuracy: number | null;
  /** Timestamp d'acquisition fourni par GeolocationPosition. Identique à timestamp. */
  gpsTimestamp?: number;
  /** Instant auquel Balloon Companion a reçu le callback GeolocationPosition. */
  receivedAt?: number;
  callbackSequence?: number;
  deliveryLatencyMs?: number;
  sameCoordinatesAsPrevious?: boolean;
  sameAltitudeAsPrevious?: boolean;
  sameGpsTimestampAsPrevious?: boolean;
  deltaGpsTimestampMs?: number;
  deltaReceivedAtMs?: number;
  timestamp: number;
  appState?: GpsAppState;
  lastPointTimestamp?: number;
  deltaTimeSincePreviousPoint?: number;
  resumedAfterBackground?: boolean;
  firstFixAfterResume?: boolean;
}

export type GpsAppState = "FOREGROUND" | "BACKGROUND" | "RESUME";

export type GpsPointQuality = "VALID" | "SUSPECT" | "INVALID";
export type GpsPointQualityReason =
  | "LOW_ACCURACY"
  | "BACKGROUND_RESUME"
  | "TIME_GAP"
  | "ALTITUDE_SPIKE"
  | "POSITION_JUMP"
  | "SPEED_OUTLIER"
  | "HEADING_OUTLIER"
  | "NONE";

/**
 * Point de projection (projection GPS ou météo)
 */
export interface ProjectionPoint {
  minutes: number;
  latitude: number;
  longitude: number;
}

/**
 * Métriques de vol calculées
 */
export interface FlightMetrics {
  altitude: number | null;
  verticalSpeed: number | null;
  groundSpeed: number | null;
  heading: number | null;
  durationSeconds: number;
  distanceKm: number;
  lastUpdated: number;
}

/**
 * État de la géolocalisation
 */
export type GeolocationState =
  | "idle"
  | "requesting"
  | "active"
  | "error"
  | "permission_denied"
  | "unavailable"
  | "simulation";

export type FlightSessionStatus =
  | "ready"
  | "acquiring"
  | "recording"
  | "stopped";

export interface PersistedFlightSession {
  version: 1;
  status: FlightSessionStatus;
  startTime: number | null;
  points: GeoPoint[];
  metrics: FlightMetrics;
  savedAt: number;
}

/**
 * Configuration des couches d'affichage
 */
export interface FlightLayerSettings {
  gpsProjection: boolean;
  weatherProjection: boolean;
  airspaces: boolean;
  powerLines: boolean;
  aeronauticalMap: boolean;
  highContrast: boolean;
}

export type BaseMap = "plan" | "satellite";

/**
 * État du suivi de vol
 */
export interface FlightTrackingState {
  isTracking: boolean;
  startTime: number | null;
  points: GeoPoint[];
  metrics: FlightMetrics;
  geolocationState: GeolocationState;
  lastError: string | null;
}

/**
 * Configuration de la géolocalisation
 */
export interface GeolocationOptions {
  enableHighAccuracy: boolean;
  maximumAge: number;
  timeout: number;
}
