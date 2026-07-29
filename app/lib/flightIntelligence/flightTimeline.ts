import type { FlightSession } from "../flightCore/entities.ts";
import type {
  FlightFacts,
  FlightTimelineEntry,
  ObservationSource,
} from "./types.ts";

function sessionSource(
  session: FlightSession,
  observedAt: number,
): ObservationSource {
  return {
    kind: "FLIGHT_SESSION",
    sessionId: session.identity.id,
    observedAt,
  };
}

/**
 * A deterministic timeline view of facts already present in one snapshot.
 */
export class FlightTimeline {
  static fromSession(
    session: FlightSession,
    facts: FlightFacts,
  ): readonly FlightTimelineEntry[] {
    const entries: FlightTimelineEntry[] = [];

    if (session.identity.createdAt !== null) {
      entries.push({
        id: "session-created",
        type: "SESSION_CREATED",
        timestamp: session.identity.createdAt,
        source: sessionSource(session, session.identity.createdAt),
        facts: [{ key: "sessionId", value: session.identity.id }],
      });
    }
    if (facts.startedAt !== null) {
      entries.push({
        id: "flight-started",
        type: "FLIGHT_STARTED",
        timestamp: facts.startedAt,
        source: sessionSource(session, facts.startedAt),
        facts: [{ key: "status", value: facts.status }],
      });
    }
    if (facts.positionTimestamp !== null && session.position.current) {
      entries.push({
        id: "position-observed",
        type: "POSITION_OBSERVED",
        timestamp: facts.positionTimestamp,
        source: {
          kind: "GPS",
          timestamp: facts.positionTimestamp,
          horizontalAccuracyMeters: facts.horizontalAccuracyMeters,
          isStale: facts.positionIsStale,
        },
        facts: [
          {
            key: "latitude",
            value: session.position.current.latitude,
            unit: "deg",
          },
          {
            key: "longitude",
            value: session.position.current.longitude,
            unit: "deg",
          },
        ],
      });
    }
    if (facts.lastUpdatedAt > 0) {
      entries.push({
        id: "phase-observed",
        type: "PHASE_OBSERVED",
        timestamp: facts.lastUpdatedAt,
        source: sessionSource(session, facts.lastUpdatedAt),
        facts: [{ key: "phase", value: facts.phase }],
      });
    }
    if (facts.currentAirspaceId !== null) {
      entries.push({
        id: "airspace-observed",
        type: "AIRSPACE_OBSERVED",
        timestamp: facts.lastUpdatedAt,
        source: {
          kind: "AIRSPACE_CONTEXT",
          airspaceId: facts.currentAirspaceId,
          status: facts.airspaceStatus,
          observedAt: facts.lastUpdatedAt,
        },
        facts: [{ key: "airspaceId", value: facts.currentAirspaceId }],
      });
    }
    if (facts.endedAt !== null) {
      entries.push({
        id: "flight-ended",
        type: "FLIGHT_ENDED",
        timestamp: facts.endedAt,
        source: sessionSource(session, facts.endedAt),
        facts: [{ key: "durationSeconds", value: facts.durationSeconds, unit: "s" }],
      });
    }

    return entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          left.entry.timestamp - right.entry.timestamp ||
          left.index - right.index,
      )
      .map(({ entry }) => entry);
  }
}
