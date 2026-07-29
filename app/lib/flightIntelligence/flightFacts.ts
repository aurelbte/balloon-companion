import type { FlightSession } from "../flightCore/entities.ts";
import type { FlightFacts } from "./types.ts";

/**
 * Projects a FlightSession into immutable, calculation-free facts.
 */
export function extractFlightFacts(session: FlightSession): FlightFacts {
  return {
    sessionId: session.identity.id,
    status: session.state.status,
    phase: session.phase,
    isRecording: session.state.isRecording,
    startedAt: session.time.startedAt,
    endedAt: session.time.endedAt,
    durationSeconds: session.time.durationSeconds,
    hasCurrentPosition: session.position.current !== null,
    positionIsStale: session.position.isStale,
    positionTimestamp: session.position.current?.timestamp ?? null,
    horizontalAccuracyMeters:
      session.position.current?.accuracy ?? null,
    altitudeAmslMeters: session.altitude.amslMeters,
    groundSpeedMetersPerSecond:
      session.motion.groundSpeedMetersPerSecond,
    headingDegrees: session.motion.headingDegrees,
    verticalSpeedMetersPerSecond:
      session.motion.verticalSpeedMetersPerSecond,
    trackPointCount: session.trajectory.points.length,
    gpsProjectionPointCount: session.projections.gps.length,
    weatherProjectionPointCount: session.projections.weather.length,
    plannedTrajectoryCount: session.projections.planned.length,
    currentAirspaceId:
      session.airspace.current?.airspace.airspaceId ?? null,
    airspaceStatus: session.airspace.status,
    hasInterruptedFlight:
      session.recovery.interruptedFlight !== null,
    hasCompletedFlight: session.recovery.completedFlight !== null,
    lastUpdatedAt: session.time.lastUpdatedAt,
  };
}
