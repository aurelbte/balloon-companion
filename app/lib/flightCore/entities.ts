import type {
  FlightMetrics,
  FlightSessionStatus,
  GeoPoint,
  GeolocationState,
  ProjectionPoint,
} from "../../types/flight";
import type { FlightContext } from "../flightContext";
import type {
  RecordedFlight,
  RecordedFlightSummary,
} from "../recordedFlight";
import type { ExportedPlannedTrajectory } from "../trajectory/weatherAnalysisStorage";

export const FLIGHT_SESSION_SCHEMA_VERSION = 1;

/**
 * Operational phase known by the core. APPROACH deliberately exists for future
 * use but is never inferred from descent alone.
 */
export type FlightPhase =
  | "PRE_FLIGHT"
  | "CLIMB"
  | "CRUISE"
  | "DESCENT"
  | "APPROACH"
  | "COMPLETED"
  | "UNKNOWN";

export interface FlightCapabilities {
  canStartRecording: boolean;
  canStopRecording: boolean;
  canResumeInterruptedFlight: boolean;
  canCompleteInterruptedFlight: boolean;
  canUseCurrentPosition: boolean;
  canProjectGpsTrajectory: boolean;
  canDisplayWeatherProjection: boolean;
  hasPlannedTrajectories: boolean;
  hasAirspaceContext: boolean;
}

export type FlightEvent =
  | { type: "GPS_POSITION_UPDATED"; point: GeoPoint; occurredAt: number }
  | { type: "GPS_BECAME_STALE"; occurredAt: number }
  | { type: "RECORDING_STARTED"; flightId: string; occurredAt: number }
  | { type: "RECORDING_STOPPED"; flightId: string; occurredAt: number }
  | { type: "FLIGHT_INTERRUPTED"; flightId: string; occurredAt: number }
  | { type: "FLIGHT_RESUMED"; flightId: string; occurredAt: number }
  | { type: "FLIGHT_COMPLETED"; flightId: string; occurredAt: number }
  | {
      type: "CURRENT_AIRSPACE_CHANGED";
      airspaceId: string | null;
      occurredAt: number;
    };

export interface FlightSession {
  schemaVersion: typeof FLIGHT_SESSION_SCHEMA_VERSION;
  identity: {
    id: string | null;
    createdAt: number | null;
  };
  state: {
    status: FlightSessionStatus;
    isRecording: boolean;
    storageReady: boolean;
    storageError: string | null;
  };
  phase: FlightPhase;
  time: {
    startedAt: number | null;
    endedAt: number | null;
    durationSeconds: number;
    lastUpdatedAt: number;
  };
  position: {
    current: GeoPoint | null;
    geolocationState: GeolocationState;
    isStale: boolean;
  };
  altitude: {
    amslMeters: number | null;
    groundMeters: null;
    qnhHpa: number | null;
  };
  motion: {
    groundSpeedMetersPerSecond: number | null;
    headingDegrees: number | null;
    verticalSpeedMetersPerSecond: number | null;
  };
  trajectory: {
    points: readonly GeoPoint[];
  };
  statistics: {
    metrics: FlightMetrics;
    recorded: RecordedFlightSummary | null;
  };
  projections: {
    gps: readonly ProjectionPoint[];
    weather: readonly ProjectionPoint[];
    planned: readonly ExportedPlannedTrajectory[];
  };
  airspace: FlightContext["airspace"];
  recovery: {
    interruptedFlight: RecordedFlight | null;
    completedFlight: RecordedFlight | null;
  };
  capabilities: FlightCapabilities;
}

export type FlightEvents = FlightEvent;
