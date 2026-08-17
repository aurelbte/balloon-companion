import {
  calculateRecordedFlightSummary,
  distanceBetweenRecordedPoints,
  recalculateFlightStatistics,
  type RecordedFlight,
  type RecordedFlightPoint,
} from "./recordedFlight.ts";
import type { CompletionJournalFlight } from "./flightCompletion.ts";
import type { JournalFlight } from "./journalMockData.ts";
import type { PersistedFlightSession } from "../types/flight.ts";
import { calculateRecordedFlightSummary as calculateSummary, geoPointToRecordedFlightPoint } from "./recordedFlight.ts";
import { buildGeneratedFlightTitle, UNKNOWN_ARRIVAL, UNKNOWN_DEPARTURE } from "./journalFlightTitle.ts";

export function journalFlightsForMode(flights: readonly JournalFlight[], demoEnabled: boolean): JournalFlight[] {
  return flights.filter((flight) => demoEnabled || flight.origin === "REAL_GPS" || flight.origin === "MANUAL");
}

export function latestRealJournalFlight(flights: readonly CompletionJournalFlight[]): CompletionJournalFlight | null {
  return journalFlightsForMode(flights, false).sort((left, right) => (right.startedAt ?? Date.parse(right.dateIso)) - (left.startedAt ?? Date.parse(left.dateIso)))[0] as CompletionJournalFlight | undefined ?? null;
}

export function legacyFlightSessionToRecordedFlight(session: PersistedFlightSession): RecordedFlight | null {
  if (session.points.length === 0) return null;
  const points = session.points.map(geoPointToRecordedFlightPoint);
  const startedAt = session.startTime ?? points[0]!.timestamp;
  const endedAt = session.status === "stopped" ? points.at(-1)!.timestamp : null;
  return {
    id: `legacy-flight-${startedAt}`,
    schemaVersion: 1,
    status: session.status === "stopped" ? "COMPLETED" : "INTERRUPTED",
    startedAt,
    endedAt,
    points,
    summary: calculateSummary(points, startedAt, endedAt),
    createdAt: startedAt,
    updatedAt: session.savedAt,
  };
}

function finiteValues(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function average(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}

function dateLabels(timestamp: number): { date: string; dateIso: string } {
  const date = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date),
    dateIso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  };
}

export function recordedFlightPointsToJournalPoints(
  source: RecordedFlight,
): JournalFlight["points"] {
  return source.points.map((point) => ({
    longitude: point.longitude,
    latitude: point.latitude,
    elapsedMinutes: Math.max(0, (point.timestamp - source.startedAt) / 60_000),
    altitudeM: point.altitudeMeters,
    speedKmh: journalSpeedKmh(point),
  }));
}

const UNRELIABLE_SPEED_REASONS = new Set([
  "LOW_ACCURACY",
  "BACKGROUND_RESUME",
  "TIME_GAP",
  "POSITION_JUMP",
  "SPEED_OUTLIER",
  "HEADING_OUTLIER",
]);

export function journalSpeedKmh(point: RecordedFlightPoint): number | null {
  const speed = point.speedMetersPerSecond;
  if (speed === null || !Number.isFinite(speed) || speed < 0 || point.quality === "INVALID") return null;
  if (point.quality === "SUSPECT" && UNRELIABLE_SPEED_REASONS.has(point.qualityReason ?? "NONE")) return null;
  return speed * 3.6;
}

export function recordedFlightToJournalFlight(
  source: RecordedFlight,
  options: Readonly<{ recovered?: boolean; balloonRegistration?: string }> = {},
): CompletionJournalFlight {
  const endedAt = source.endedAt ?? source.points.at(-1)?.timestamp ?? source.updatedAt;
  const summary = recalculateFlightStatistics(source.points, source.startedAt, endedAt);
  const date = dateLabels(source.startedAt);
  const statisticPoints = source.points.filter(({ quality }) => quality === undefined || quality === "VALID");
  const altitudes = finiteValues(statisticPoints.map(({ altitudeMeters }) => altitudeMeters));
  const speeds = finiteValues(statisticPoints.map(({ speedMetersPerSecond }) => speedMetersPerSecond));
  const headings = finiteValues(statisticPoints.map(({ headingDegrees }) => headingDegrees));
  const first = statisticPoints[0];
  const last = statisticPoints.at(-1);
  const directDistanceKm = first && last ? distanceBetweenRecordedPoints(first, last) / 1000 : 0;
  const departure = source.startLocationLabel?.trim() || UNKNOWN_DEPARTURE;
  const arrival = source.endLocationLabel?.trim() || UNKNOWN_ARRIVAL;
  const takeoffTime = timeLabel(source.startedAt);
  return {
    id: source.id,
    sourceFlightId: source.id,
    startedAt: source.startedAt,
    startLocationLabel: departure,
    endLocationLabel: arrival,
    departure,
    arrival,
    generatedTitle: source.generatedTitle?.trim() || buildGeneratedFlightTitle({ departure, arrival }),
    ...date,
    balloonRegistration: options.balloonRegistration ?? source.balloonRegistration ?? "Non renseigné",
    durationMinutes: Math.max(0, Math.round(summary.durationSeconds / 60)),
    distanceKm: summary.distanceMeters / 1000,
    takeoffTime,
    landingTime: timeLabel(endedAt),
    maxAltitudeM: summary.maxAltitudeMeters,
    maxSpeedKmh: summary.maxGroundSpeedMetersPerSecond === null ? null : summary.maxGroundSpeedMetersPerSecond * 3.6,
    notes: options.recovered ? "Vol récupéré depuis une session GPS locale." : null,
    statistics: {
      takeoffAltitudeAmslM: first?.altitudeMeters ?? null,
      landingAltitudeAmslM: last?.altitudeMeters ?? null,
      averageAltitudeAmslM: average(altitudes),
      averageSpeedKmh: average(speeds) === null ? null : average(speeds)! * 3.6,
      minimumInFlightSpeedKmh: speeds.length ? Math.min(...speeds) * 3.6 : null,
      maximumClimbRateMps: summary.maximumClimbRateMetersPerSecond ?? null,
      maximumDescentRateMps: summary.maximumDescentRateMetersPerSecond ?? null,
      averageHeadingDeg: average(headings),
      directDistanceKm,
    },
    // La trace détaillée reste dans IndexedDB. Le Journal ne conserve que ses métadonnées.
    points: [],
    logbookStatus: "CARNET_PENDING",
    origin: "REAL_GPS",
    ...(options.recovered ? { recovered: true } : {}),
  };
}
