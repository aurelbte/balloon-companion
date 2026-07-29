import type { FlightSession } from "../flightCore/entities";
import type {
  FlightFacts,
  FlightTimelineEntry,
  Observation,
} from "../flightIntelligence/types";

export const FLIGHT_RECORD_SCHEMA_VERSION = 1;

export type FlightRecordBuildErrorCode =
  | "FLIGHT_NOT_COMPLETED"
  | "MISSING_FLIGHT_ID"
  | "MISSING_END_TIME"
  | "SOURCE_ID_MISMATCH";

export class FlightRecordBuildError extends Error {
  readonly code: FlightRecordBuildErrorCode;

  constructor(code: FlightRecordBuildErrorCode, message: string) {
    super(message);
    this.name = "FlightRecordBuildError";
    this.code = code;
  }
}

export interface FlightIdentity {
  readonly flightId: string | null;
  readonly sessionSchemaVersion: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

/**
 * Aircraft information is deliberately unavailable until FlightSession owns a
 * verified aircraft source. No registration or type is inferred.
 */
export interface FlightAircraft {
  readonly status: "UNAVAILABLE";
  readonly registration: null;
  readonly type: null;
  readonly manufacturer: null;
}

/**
 * Crew information is deliberately empty until it exists in FlightSession.
 */
export interface FlightCrew {
  readonly status: "UNAVAILABLE";
  readonly pilot: null;
  readonly members: readonly [];
}

export interface FlightMediaItem {
  readonly id: string;
  readonly kind: "PHOTO" | "VIDEO" | "AUDIO" | "OTHER";
  readonly capturedAt: number | null;
  readonly reference: string;
}

export interface FlightMedia {
  readonly items: readonly FlightMediaItem[];
}

export interface FlightNote {
  readonly id: string;
  readonly createdAt: number;
  readonly text: string;
}

export interface FlightNotes {
  readonly entries: readonly FlightNote[];
}

/**
 * Integrity fingerprint, not a cryptographic or legal signature.
 */
export interface FlightSignature {
  readonly algorithm: "BC-FNV1A-32";
  readonly scope: "FLIGHT_RECORD_SOURCES_V1";
  readonly value: string;
  readonly generatedAt: number;
}

export interface FlightMetadata {
  readonly schemaVersion: typeof FLIGHT_RECORD_SCHEMA_VERSION;
  readonly archivedAt: number;
  readonly sourceVersions: {
    readonly flightSession: number;
    readonly flightFacts: 1;
    readonly flightTimeline: 1;
    readonly observations: 1;
  };
  readonly counts: {
    readonly trackPoints: number;
    readonly timelineEntries: number;
    readonly observations: number;
    readonly mediaItems: number;
    readonly notes: number;
  };
}

export interface FlightRecord {
  readonly identity: FlightIdentity;
  readonly aircraft: FlightAircraft;
  readonly crew: FlightCrew;
  readonly media: FlightMedia;
  readonly notes: FlightNotes;
  readonly signature: FlightSignature;
  readonly metadata: FlightMetadata;
  readonly session: FlightSession;
  readonly facts: FlightFacts;
  readonly timeline: readonly FlightTimelineEntry[];
  readonly observations: readonly Observation[];
}

export interface FlightRecordSources {
  readonly session: FlightSession;
  readonly facts: FlightFacts;
  readonly timeline: readonly FlightTimelineEntry[];
  readonly observations: readonly Observation[];
}
