import {
  FLIGHT_RECORD_SCHEMA_VERSION,
  FlightRecordBuildError,
  type FlightRecord,
  type FlightRecordSources,
} from "./entities.ts";
import {
  cloneDomainValue,
  deepFreeze,
} from "./immutability.ts";
import { createFlightRecordFingerprint } from "./signature.ts";

function validateSources(sources: FlightRecordSources): void {
  if (
    sources.session.phase !== "COMPLETED" ||
    !sources.facts.hasCompletedFlight
  ) {
    throw new FlightRecordBuildError(
      "FLIGHT_NOT_COMPLETED",
      "FlightRecord exige un vol terminé.",
    );
  }
  if (sources.session.identity.id === null) {
    throw new FlightRecordBuildError(
      "MISSING_FLIGHT_ID",
      "FlightRecord exige un identifiant de vol.",
    );
  }
  if (
    sources.session.time.endedAt === null ||
    sources.facts.endedAt === null
  ) {
    throw new FlightRecordBuildError(
      "MISSING_END_TIME",
      "FlightRecord exige une heure de fin.",
    );
  }
  if (sources.facts.sessionId !== sources.session.identity.id) {
    throw new FlightRecordBuildError(
      "SOURCE_ID_MISMATCH",
      "FlightSession et FlightFacts ne décrivent pas le même vol.",
    );
  }
}

function archiveTimestamp(sources: FlightRecordSources): number {
  return (
    sources.session.time.endedAt ??
    sources.facts.endedAt ??
    sources.session.time.lastUpdatedAt ??
    sources.session.time.startedAt ??
    sources.session.identity.createdAt ??
    0
  );
}

/**
 * Builds an immutable FlightRecord from the four authorized domain sources.
 */
export class FlightRecordBuilder {
  build(sources: FlightRecordSources): FlightRecord {
    validateSources(sources);
    const copiedSources = cloneDomainValue(sources);
    const archivedAt = archiveTimestamp(copiedSources);
    const record: FlightRecord = {
      identity: {
        flightId: copiedSources.session.identity.id,
        sessionSchemaVersion: copiedSources.session.schemaVersion,
        startedAt: copiedSources.session.time.startedAt,
        endedAt: copiedSources.session.time.endedAt,
      },
      aircraft: {
        status: "UNAVAILABLE",
        registration: null,
        type: null,
        manufacturer: null,
      },
      crew: {
        status: "UNAVAILABLE",
        pilot: null,
        members: [],
      },
      media: {
        items: [],
      },
      notes: {
        entries: [],
      },
      signature: {
        algorithm: "BC-FNV1A-32",
        scope: "FLIGHT_RECORD_SOURCES_V1",
        value: createFlightRecordFingerprint(copiedSources),
        generatedAt: archivedAt,
      },
      metadata: {
        schemaVersion: FLIGHT_RECORD_SCHEMA_VERSION,
        archivedAt,
        sourceVersions: {
          flightSession: copiedSources.session.schemaVersion,
          flightFacts: 1,
          flightTimeline: 1,
          observations: 1,
        },
        counts: {
          trackPoints: copiedSources.session.trajectory.points.length,
          timelineEntries: copiedSources.timeline.length,
          observations: copiedSources.observations.length,
          mediaItems: 0,
          notes: 0,
        },
      },
      session: copiedSources.session,
      facts: copiedSources.facts,
      timeline: copiedSources.timeline,
      observations: copiedSources.observations,
    };
    return deepFreeze(record) as FlightRecord;
  }
}
