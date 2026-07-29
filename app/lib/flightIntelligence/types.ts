import type {
  FlightPhase,
  FlightSession,
} from "../flightCore/entities";

export type ObservationCategory =
  | "FLIGHT_STATE"
  | "POSITION"
  | "MOTION"
  | "AIRSPACE"
  | "PROJECTION"
  | "RECOVERY"
  | "DATA_QUALITY"
  | "CONSISTENCY";

/**
 * Describes the significance of a fact, never an instruction to the pilot.
 */
export type ObservationSeverity =
  | "INFORMATION"
  | "NOTICE"
  | "SIGNIFICANT"
  | "CRITICAL";

export type ObservationConfidence =
  | "CONFIRMED"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNKNOWN";

export type ObservationSource =
  | {
      kind: "FLIGHT_SESSION";
      sessionId: string | null;
      observedAt: number;
    }
  | {
      kind: "GPS";
      timestamp: number | null;
      horizontalAccuracyMeters: number | null;
      isStale: boolean;
    }
  | {
      kind: "AIRSPACE_CONTEXT";
      airspaceId: string | null;
      status: FlightSession["airspace"]["status"];
      observedAt: number;
    }
  | {
      kind: "PROJECTION";
      projectionKind: "GPS" | "WEATHER" | "PLANNED";
      pointCount: number;
      observedAt: number;
    }
  | {
      kind: "CONSISTENCY_ENGINE";
      issueCode: ConsistencyIssueCode;
      observedAt: number;
    };

export interface ObservationEvidence {
  readonly key: string;
  readonly value: string | number | boolean | null;
  readonly unit?: string;
}

export interface Observation {
  readonly id: string;
  readonly category: ObservationCategory;
  readonly severity: ObservationSeverity;
  readonly confidence: ObservationConfidence;
  readonly source: ObservationSource;
  readonly title: string;
  readonly statement: string;
  readonly observedAt: number;
  readonly evidence: readonly ObservationEvidence[];
}

export interface FlightFacts {
  readonly sessionId: string | null;
  readonly status: FlightSession["state"]["status"];
  readonly phase: FlightPhase;
  readonly isRecording: boolean;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly durationSeconds: number;
  readonly hasCurrentPosition: boolean;
  readonly positionIsStale: boolean;
  readonly positionTimestamp: number | null;
  readonly horizontalAccuracyMeters: number | null;
  readonly altitudeAmslMeters: number | null;
  readonly groundSpeedMetersPerSecond: number | null;
  readonly headingDegrees: number | null;
  readonly verticalSpeedMetersPerSecond: number | null;
  readonly trackPointCount: number;
  readonly gpsProjectionPointCount: number;
  readonly weatherProjectionPointCount: number;
  readonly plannedTrajectoryCount: number;
  readonly currentAirspaceId: string | null;
  readonly airspaceStatus: FlightSession["airspace"]["status"];
  readonly hasInterruptedFlight: boolean;
  readonly hasCompletedFlight: boolean;
  readonly lastUpdatedAt: number;
}

export type FlightTimelineEntryType =
  | "SESSION_CREATED"
  | "FLIGHT_STARTED"
  | "POSITION_OBSERVED"
  | "PHASE_OBSERVED"
  | "AIRSPACE_OBSERVED"
  | "FLIGHT_ENDED";

export interface FlightTimelineEntry {
  readonly id: string;
  readonly type: FlightTimelineEntryType;
  readonly timestamp: number;
  readonly source: ObservationSource;
  readonly facts: readonly ObservationEvidence[];
}

export type ConsistencyIssueCode =
  | "RECORDING_WITHOUT_ID"
  | "RECORDING_WITHOUT_START_TIME"
  | "COMPLETED_WITHOUT_END_TIME"
  | "STALE_POSITION_MARKED_USABLE"
  | "PROJECTION_WITHOUT_CURRENT_POSITION";

export interface ConsistencyIssue {
  readonly code: ConsistencyIssueCode;
  readonly severity: ObservationSeverity;
  readonly statement: string;
  readonly evidence: readonly ObservationEvidence[];
}

export interface ConfidenceInput {
  readonly source: ObservationSource;
  readonly facts: FlightFacts;
}
