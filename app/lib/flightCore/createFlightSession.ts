import type {
  FlightMetrics,
  FlightSessionStatus,
  GeoPoint,
  GeolocationState,
  ProjectionPoint,
} from "../../types/flight.ts";
import type { FlightContext } from "../flightContext.ts";
import type { RecordedFlight } from "../recordedFlight.ts";
import type { ExportedPlannedTrajectory } from "../trajectory/weatherAnalysisStorage.ts";
import {
  FLIGHT_SESSION_SCHEMA_VERSION,
  type FlightCapabilities,
  type FlightPhase,
  type FlightSession,
} from "./entities.ts";

export interface CreateFlightSessionInput {
  status: FlightSessionStatus;
  storageReady: boolean;
  storageError: string | null;
  activeFlight: RecordedFlight | null;
  recoverableFlight: RecordedFlight | null;
  completedFlight: RecordedFlight | null;
  points: readonly GeoPoint[];
  metrics: FlightMetrics;
  currentPosition: GeoPoint | null;
  geolocationState: GeolocationState;
  isPositionStale: boolean;
  gpsProjection: readonly ProjectionPoint[];
  weatherProjection: readonly ProjectionPoint[];
  plannedTrajectories: readonly ExportedPlannedTrajectory[];
  flightContext: FlightContext;
  qnhHpa?: number | null;
  groundMeters?: number | null;
}

/**
 * Keeps the exact vario thresholds previously owned by FlightInstruments.
 * Descent is never promoted to APPROACH without a future explicit source.
 */
export function resolveFlightPhase({
  status,
  verticalSpeedMetersPerSecond,
  hasCompletedFlight,
}: {
  status: FlightSessionStatus;
  verticalSpeedMetersPerSecond: number | null;
  hasCompletedFlight: boolean;
}): FlightPhase {
  if (hasCompletedFlight || status === "stopped") return "COMPLETED";
  if (status !== "recording") return "PRE_FLIGHT";
  if (
    verticalSpeedMetersPerSecond !== null &&
    Number.isFinite(verticalSpeedMetersPerSecond)
  ) {
    if (verticalSpeedMetersPerSecond > 0.2) return "CLIMB";
    if (verticalSpeedMetersPerSecond < -0.2) return "DESCENT";
  }
  return "CRUISE";
}

function createCapabilities(
  input: CreateFlightSessionInput,
): FlightCapabilities {
  const isRecording = input.status === "recording";
  const hasCurrentPosition =
    input.currentPosition !== null && !input.isPositionStale;
  return {
    canStartRecording:
      input.storageReady && !isRecording && input.recoverableFlight === null,
    canStopRecording: isRecording && input.activeFlight !== null,
    canResumeInterruptedFlight: input.recoverableFlight !== null,
    canCompleteInterruptedFlight: input.recoverableFlight !== null,
    canUseCurrentPosition: hasCurrentPosition,
    canProjectGpsTrajectory: input.gpsProjection.length > 0,
    canDisplayWeatherProjection: input.weatherProjection.length > 0,
    hasPlannedTrajectories: input.plannedTrajectories.length > 0,
    hasAirspaceContext: input.flightContext.airspace.current !== null,
  };
}

/**
 * Builds the immutable application-facing snapshot from existing domain
 * outputs. It performs no GPS, trajectory, statistics, or airspace calculation.
 */
export function createFlightSession(
  input: CreateFlightSessionInput,
): FlightSession {
  const sourceFlight =
    input.activeFlight ?? input.completedFlight ?? input.recoverableFlight;
  const metrics = input.metrics;
  return {
    schemaVersion: FLIGHT_SESSION_SCHEMA_VERSION,
    identity: {
      id: sourceFlight?.id ?? null,
      createdAt: sourceFlight?.createdAt ?? null,
    },
    state: {
      status: input.status,
      isRecording: input.status === "recording",
      storageReady: input.storageReady,
      storageError: input.storageError,
    },
    phase: resolveFlightPhase({
      status: input.status,
      verticalSpeedMetersPerSecond: metrics.verticalSpeed,
      hasCompletedFlight: input.completedFlight !== null,
    }),
    time: {
      startedAt: sourceFlight?.startedAt ?? null,
      endedAt: sourceFlight?.endedAt ?? null,
      durationSeconds: metrics.durationSeconds,
      lastUpdatedAt: metrics.lastUpdated,
    },
    position: {
      current: input.currentPosition,
      geolocationState: input.geolocationState,
      isStale: input.isPositionStale,
    },
    altitude: {
      amslMeters: metrics.altitude,
      groundMeters: input.groundMeters ?? null,
      qnhHpa: input.qnhHpa ?? null,
    },
    motion: {
      groundSpeedMetersPerSecond: metrics.groundSpeed,
      headingDegrees: metrics.heading,
      verticalSpeedMetersPerSecond: metrics.verticalSpeed,
    },
    trajectory: {
      points: input.points,
    },
    statistics: {
      metrics,
      recorded: sourceFlight?.summary ?? null,
    },
    projections: {
      gps: input.gpsProjection,
      weather: input.weatherProjection,
      planned: input.plannedTrajectories,
    },
    airspace: input.flightContext.airspace,
    recovery: {
      interruptedFlight: input.recoverableFlight,
      completedFlight: input.completedFlight,
    },
    capabilities: createCapabilities(input),
  };
}
