import type {
  ConfidenceInput,
  ObservationConfidence,
} from "./types.ts";

/**
 * Assigns confidence from provenance and data quality only.
 * It never changes or validates the underlying fact.
 */
export class ConfidenceEngine {
  evaluate({ source, facts }: ConfidenceInput): ObservationConfidence {
    if (source.kind === "CONSISTENCY_ENGINE") return "CONFIRMED";
    if (source.kind === "FLIGHT_SESSION") return "CONFIRMED";
    if (source.kind === "AIRSPACE_CONTEXT") {
      return source.status === "CONFIRMED"
        ? "HIGH"
        : source.status === "HORIZONTAL_MATCH"
          ? "MEDIUM"
          : "LOW";
    }
    if (source.kind === "PROJECTION") {
      return source.pointCount > 1 ? "HIGH" : "LOW";
    }
    if (source.kind === "GPS") {
      if (source.isStale || source.timestamp === null) return "LOW";
      const accuracy = source.horizontalAccuracyMeters;
      if (accuracy === null) return "MEDIUM";
      if (accuracy <= 20) return "HIGH";
      if (accuracy <= 100) return "MEDIUM";
      return "LOW";
    }
    return facts.lastUpdatedAt > 0 ? "MEDIUM" : "UNKNOWN";
  }
}
