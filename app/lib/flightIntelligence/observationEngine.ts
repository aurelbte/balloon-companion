import type { FlightSession } from "../flightCore/entities.ts";
import { ConfidenceEngine } from "./confidenceEngine.ts";
import { ConsistencyEngine } from "./consistencyEngine.ts";
import { extractFlightFacts } from "./flightFacts.ts";
import { FlightTimeline } from "./flightTimeline.ts";
import type {
  FlightFacts,
  FlightTimelineEntry,
  Observation,
  ObservationSource,
} from "./types.ts";

export interface ObservationResult {
  readonly facts: FlightFacts;
  readonly timeline: readonly FlightTimelineEntry[];
  readonly observations: readonly Observation[];
}

/**
 * Produces factual, non-prescriptive observations from FlightSession only.
 */
export class ObservationEngine {
  private readonly confidenceEngine: ConfidenceEngine;
  private readonly consistencyEngine: ConsistencyEngine;

  constructor(
    confidenceEngine = new ConfidenceEngine(),
    consistencyEngine = new ConsistencyEngine(),
  ) {
    this.confidenceEngine = confidenceEngine;
    this.consistencyEngine = consistencyEngine;
  }

  observe(session: FlightSession): ObservationResult {
    const facts = extractFlightFacts(session);
    const observedAt =
      facts.positionTimestamp ?? facts.lastUpdatedAt ?? 0;
    const observations: Observation[] = [];

    const add = (
      observation: Omit<Observation, "confidence">,
    ) => {
      observations.push({
        ...observation,
        confidence: this.confidenceEngine.evaluate({
          source: observation.source,
          facts,
        }),
      });
    };

    const sessionSource: ObservationSource = {
      kind: "FLIGHT_SESSION",
      sessionId: facts.sessionId,
      observedAt,
    };
    add({
      id: `flight-state:${facts.status}`,
      category: "FLIGHT_STATE",
      severity: "INFORMATION",
      source: sessionSource,
      title: "État du vol",
      statement: `État courant : ${facts.status}.`,
      observedAt,
      evidence: [
        { key: "status", value: facts.status },
        { key: "phase", value: facts.phase },
      ],
    });

    if (!facts.hasCurrentPosition || facts.positionIsStale) {
      const source: ObservationSource = {
        kind: "GPS",
        timestamp: facts.positionTimestamp,
        horizontalAccuracyMeters: facts.horizontalAccuracyMeters,
        isStale: facts.positionIsStale,
      };
      add({
        id: facts.positionIsStale
          ? "position:stale"
          : "position:unavailable",
        category: "DATA_QUALITY",
        severity: "NOTICE",
        source,
        title: "Position GPS",
        statement: facts.positionIsStale
          ? "La dernière position disponible est ancienne."
          : "Aucune position GPS courante n’est disponible.",
        observedAt,
        evidence: [
          { key: "positionIsStale", value: facts.positionIsStale },
          {
            key: "horizontalAccuracyMeters",
            value: facts.horizontalAccuracyMeters,
            unit: "m",
          },
        ],
      });
    }

    if (facts.hasInterruptedFlight) {
      add({
        id: "recovery:interrupted-flight",
        category: "RECOVERY",
        severity: "NOTICE",
        source: sessionSource,
        title: "Vol interrompu",
        statement: "Un enregistrement interrompu est conservé.",
        observedAt,
        evidence: [{ key: "hasInterruptedFlight", value: true }],
      });
    }

    for (const issue of this.consistencyEngine.evaluate(session, facts)) {
      const source: ObservationSource = {
        kind: "CONSISTENCY_ENGINE",
        issueCode: issue.code,
        observedAt,
      };
      add({
        id: `consistency:${issue.code}`,
        category: "CONSISTENCY",
        severity: issue.severity,
        source,
        title: "Cohérence des données",
        statement: issue.statement,
        observedAt,
        evidence: issue.evidence,
      });
    }

    return {
      facts,
      timeline: FlightTimeline.fromSession(session, facts),
      observations,
    };
  }
}
