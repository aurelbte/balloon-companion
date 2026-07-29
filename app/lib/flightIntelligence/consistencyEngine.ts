import type { FlightSession } from "../flightCore/entities.ts";
import type {
  ConsistencyIssue,
  FlightFacts,
} from "./types.ts";

/**
 * Reports contradictions without repairing data or changing FlightSession.
 */
export class ConsistencyEngine {
  evaluate(
    session: FlightSession,
    facts: FlightFacts,
  ): readonly ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    if (facts.isRecording && facts.sessionId === null) {
      issues.push({
        code: "RECORDING_WITHOUT_ID",
        severity: "SIGNIFICANT",
        statement: "Enregistrement actif sans identifiant de vol.",
        evidence: [{ key: "status", value: facts.status }],
      });
    }
    if (facts.isRecording && facts.startedAt === null) {
      issues.push({
        code: "RECORDING_WITHOUT_START_TIME",
        severity: "SIGNIFICANT",
        statement: "Enregistrement actif sans heure de départ.",
        evidence: [{ key: "status", value: facts.status }],
      });
    }
    if (facts.hasCompletedFlight && facts.endedAt === null) {
      issues.push({
        code: "COMPLETED_WITHOUT_END_TIME",
        severity: "SIGNIFICANT",
        statement: "Vol terminé sans heure de fin.",
        evidence: [{ key: "phase", value: facts.phase }],
      });
    }
    if (
      facts.positionIsStale &&
      session.capabilities.canUseCurrentPosition
    ) {
      issues.push({
        code: "STALE_POSITION_MARKED_USABLE",
        severity: "SIGNIFICANT",
        statement: "Position ancienne marquée comme position utilisable.",
        evidence: [{ key: "positionIsStale", value: true }],
      });
    }
    if (
      !facts.hasCurrentPosition &&
      (facts.gpsProjectionPointCount > 0 ||
        facts.weatherProjectionPointCount > 0)
    ) {
      issues.push({
        code: "PROJECTION_WITHOUT_CURRENT_POSITION",
        severity: "NOTICE",
        statement: "Projection disponible sans position GPS courante.",
        evidence: [
          {
            key: "gpsProjectionPointCount",
            value: facts.gpsProjectionPointCount,
          },
          {
            key: "weatherProjectionPointCount",
            value: facts.weatherProjectionPointCount,
          },
        ],
      });
    }
    return issues;
  }
}
