import type { LocalDataScope } from "./auth/dataScope.ts";
import type { CompletionJournalFlight } from "./flightCompletion.ts";
import type { JournalFlightPoint } from "./journalMockData.ts";
import {
  RECORDED_FLIGHT_SCHEMA_VERSION,
  type RecordedFlight,
  type RecordedFlightPoint,
} from "./recordedFlight.ts";

export const HAZEBROUCK_BACKUP_FLIGHT_ID = "4aa82864-3c96-44e9-abf1-3d8c96943239";

export type RecordedFlightBackupRestoreResult = Readonly<{
  state: "RESTORED" | "ALREADY_PRESENT" | "CONFLICT" | "REFUSED" | "ERROR";
  flightId: string | null;
  recordedFlightRestored: boolean;
  journalFlightRestored: boolean;
  pointsCount: number;
  mutationEnqueued: boolean;
  conflict: boolean;
  reason: string;
}>;

type ValidatedBackup = Readonly<{
  journalFlight: CompletionJournalFlight;
  recordedFlight: RecordedFlight;
}>;

export type RestoreRecordedFlightBackupDependencies = Readonly<{
  scope: LocalDataScope | null;
  getCurrentScope: () => LocalDataScope | null;
  getRecordedFlight: (id: string) => Promise<RecordedFlight | null>;
  getJournalFlights: () => readonly CompletionJournalFlight[];
  persistRecordedFlight: (flight: RecordedFlight) => Promise<void>;
  persistJournalFlight: (flight: CompletionJournalFlight) => boolean;
  enqueueFlightUpsert: (id: string) => Promise<boolean>;
}>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return finite(latitude) && latitude >= -90 && latitude <= 90 &&
    finite(longitude) && longitude >= -180 && longitude <= 180;
}

function asRecordedPoint(point: unknown, startedAt: number): RecordedFlightPoint | null {
  if (!point || typeof point !== "object") return null;
  const value = point as Partial<RecordedFlightPoint & JournalFlightPoint>;
  if (validCoordinate(value.latitude, value.longitude) && finite(value.timestamp)) {
    return structuredClone(value as RecordedFlightPoint);
  }
  if (!validCoordinate(value.latitude, value.longitude) || !finite(value.elapsedMinutes) || value.elapsedMinutes < 0) return null;
  if (value.altitudeM !== null && !finite(value.altitudeM)) return null;
  if (value.speedKmh !== null && !finite(value.speedKmh)) return null;
  return {
    timestamp: startedAt + value.elapsedMinutes * 60_000,
    latitude: value.latitude!,
    longitude: value.longitude!,
    altitudeMeters: value.altitudeM,
    speedMetersPerSecond: value.speedKmh === null ? null : value.speedKmh! / 3.6,
    headingDegrees: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
  };
}

function invalid(reason: string, flightId: string | null = null, pointsCount = 0): RecordedFlightBackupRestoreResult {
  return { state: "REFUSED", flightId, recordedFlightRestored: false, journalFlightRestored: false, pointsCount, mutationEnqueued: false, conflict: false, reason };
}

export function validateRecordedFlightBackup(input: unknown): ValidatedBackup | RecordedFlightBackupRestoreResult {
  if (!input || typeof input !== "object") return invalid("INVALID_OBJECT");
  const backup = input as Partial<CompletionJournalFlight>;
  const id = typeof backup.id === "string" ? backup.id : null;
  if (!id || id !== HAZEBROUCK_BACKUP_FLIGHT_ID) return invalid("UNEXPECTED_FLIGHT_ID", id);
  if (backup.sourceFlightId !== id) return invalid("ID_SOURCE_FLIGHT_ID_MISMATCH", id);
  if (backup.origin !== "REAL_GPS") return invalid("INVALID_ORIGIN", id);
  if (!finite(backup.startedAt) || backup.startedAt <= 0) return invalid("INVALID_STARTED_AT", id);
  if (!Array.isArray(backup.points) || backup.points.length === 0) return invalid("INVALID_POINTS", id);
  if (
    typeof backup.departure !== "string" || !backup.departure.trim() ||
    typeof backup.arrival !== "string" || !backup.arrival.trim() ||
    typeof backup.dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(backup.dateIso) ||
    !finite(backup.durationMinutes) || backup.durationMinutes < 0 ||
    !finite(backup.distanceKm) || backup.distanceKm < 0 ||
    !["CARNET_PENDING", "CARNET_VALIDATED", "JOURNAL_ONLY"].includes(backup.logbookStatus ?? "")
  ) return invalid("INVALID_ESSENTIAL_FIELDS", id, backup.points.length);
  const points = backup.points.map((point) => asRecordedPoint(point, backup.startedAt!));
  if (points.some((point) => point === null)) return invalid("INVALID_POINTS", id, backup.points.length);
  const endedAt = backup.startedAt + backup.durationMinutes * 60_000;
  const altitudes = points.map((point) => point!.altitudeMeters).filter((value): value is number => value !== null);
  const journalFlight = structuredClone(backup as CompletionJournalFlight);
  const recordedFlight: RecordedFlight = {
    id,
    schemaVersion: RECORDED_FLIGHT_SCHEMA_VERSION,
    status: "COMPLETED",
    startedAt: backup.startedAt,
    endedAt,
    points: points as RecordedFlightPoint[],
    summary: {
      durationSeconds: backup.durationMinutes * 60,
      distanceMeters: backup.distanceKm * 1_000,
      minAltitudeMeters: altitudes.length ? Math.min(...altitudes) : null,
      maxAltitudeMeters: backup.maxAltitudeM ?? (altitudes.length ? Math.max(...altitudes) : null),
      averageGroundSpeedMetersPerSecond: backup.statistics?.averageSpeedKmh == null ? null : backup.statistics.averageSpeedKmh / 3.6,
      maxGroundSpeedMetersPerSecond: backup.maxSpeedKmh == null ? null : backup.maxSpeedKmh / 3.6,
      maximumClimbRateMetersPerSecond: backup.statistics?.maximumClimbRateMps ?? null,
      maximumDescentRateMetersPerSecond: backup.statistics?.maximumDescentRateMps ?? null,
    },
    createdAt: backup.startedAt,
    updatedAt: endedAt,
    balloonRegistration: backup.balloonRegistration,
    startLocationLabel: backup.startLocationLabel ?? backup.departure,
    endLocationLabel: backup.endLocationLabel ?? backup.arrival,
    ...(backup.generatedTitle ? { generatedTitle: backup.generatedTitle } : {}),
    ...(backup.notes ? { notes: backup.notes } : {}),
  };
  return { journalFlight, recordedFlight };
}

function normalizedJournal(flight: CompletionJournalFlight): unknown {
  return {
    ...flight,
    sourceFlightId: flight.sourceFlightId ?? flight.id,
    points: [],
  };
}

function normalizedRecorded(flight: RecordedFlight): unknown {
  return {
    id: flight.id,
    status: flight.status,
    startedAt: flight.startedAt,
    endedAt: flight.endedAt,
    points: flight.points.map((point) => ({
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      altitudeMeters: point.altitudeMeters,
      speedMetersPerSecond: point.speedMetersPerSecond,
    })),
    summary: flight.summary,
    balloonRegistration: flight.balloonRegistration,
    startLocationLabel: flight.startLocationLabel,
    endLocationLabel: flight.endLocationLabel,
    generatedTitle: flight.generatedTitle,
    notes: flight.notes,
  };
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function restoreRecordedFlightBackupTargeted(
  input: unknown,
  dependencies: RestoreRecordedFlightBackupDependencies,
): Promise<RecordedFlightBackupRestoreResult> {
  const validated = validateRecordedFlightBackup(input);
  if ("state" in validated) return validated;
  const { journalFlight, recordedFlight } = validated;
  const base = { flightId: recordedFlight.id, pointsCount: recordedFlight.points.length };
  if (!dependencies.scope?.startsWith("USER:") || dependencies.getCurrentScope() !== dependencies.scope) return { ...invalid("USER_SCOPE_REQUIRED", base.flightId, base.pointsCount) };
  const existingRecorded = await dependencies.getRecordedFlight(recordedFlight.id);
  const matchingJournals = dependencies.getJournalFlights().filter((flight) => flight.id === recordedFlight.id || flight.sourceFlightId === recordedFlight.id);
  if (matchingJournals.length > 1) return { state: "CONFLICT", ...base, recordedFlightRestored: false, journalFlightRestored: false, mutationEnqueued: false, conflict: true, reason: "MULTIPLE_JOURNAL_MATCHES" };
  const existingJournal = matchingJournals[0] ?? null;
  if (existingRecorded && !equivalent(normalizedRecorded(existingRecorded), normalizedRecorded(recordedFlight))) {
    return { state: "CONFLICT", ...base, recordedFlightRestored: false, journalFlightRestored: false, mutationEnqueued: false, conflict: true, reason: "RECORDED_FLIGHT_CONTENT_DIFFERS" };
  }
  if (existingJournal && !equivalent(normalizedJournal(existingJournal), normalizedJournal(journalFlight))) {
    return { state: "CONFLICT", ...base, recordedFlightRestored: false, journalFlightRestored: false, mutationEnqueued: false, conflict: true, reason: "JOURNAL_FLIGHT_CONTENT_DIFFERS" };
  }
  if (existingRecorded && existingJournal) {
    return { state: "ALREADY_PRESENT", ...base, recordedFlightRestored: false, journalFlightRestored: false, mutationEnqueued: false, conflict: false, reason: "EXACT_ENTITY_ALREADY_PRESENT" };
  }
  try {
    if (!existingRecorded) await dependencies.persistRecordedFlight(recordedFlight);
    if (!existingJournal && !dependencies.persistJournalFlight(journalFlight)) throw new Error("JOURNAL_PERSIST_FAILED");
    const mutationEnqueued = await dependencies.enqueueFlightUpsert(recordedFlight.id);
    if (!mutationEnqueued) throw new Error("FLIGHT_MUTATION_ENQUEUE_FAILED");
    return {
      state: "RESTORED",
      ...base,
      recordedFlightRestored: !existingRecorded,
      journalFlightRestored: !existingJournal,
      mutationEnqueued: true,
      conflict: false,
      reason: existingRecorded ? "JOURNAL_COMPLETED" : existingJournal ? "RECORDED_COMPLETED" : "FULL_RESTORE",
    };
  } catch (error) {
    return { state: "ERROR", ...base, recordedFlightRestored: false, journalFlightRestored: false, mutationEnqueued: false, conflict: false, reason: error instanceof Error ? error.message : "RESTORE_FAILED" };
  }
}
