import {
  calculateRecordedFlightSummary,
  distanceBetweenRecordedPoints,
  type RecordedFlight,
  type RecordedFlightPoint,
} from "./recordedFlight.ts";
import type { CompletionJournalFlight } from "./flightCompletion.ts";
import type { JournalFlight } from "./journalMockData.ts";
import type { PersistedFlightSession } from "../types/flight.ts";
import { calculateRecordedFlightSummary as calculateSummary, geoPointToRecordedFlightPoint } from "./recordedFlight.ts";

export function journalFlightsForMode(flights: readonly JournalFlight[], demoEnabled: boolean): JournalFlight[] {
  return flights.filter((flight) => demoEnabled || flight.origin === "REAL_GPS" || flight.origin === "MANUAL");
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

function verticalRates(points: readonly RecordedFlightPoint[]): { maximumClimbRateMps: number | null; maximumDescentRateMps: number | null } {
  const rates: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (previous.altitudeMeters === null || current.altitudeMeters === null) continue;
    const seconds = (current.timestamp - previous.timestamp) / 1000;
    if (seconds > 0) rates.push((current.altitudeMeters - previous.altitudeMeters) / seconds);
  }
  return {
    maximumClimbRateMps: rates.length ? Math.max(...rates) : null,
    maximumDescentRateMps: rates.length ? Math.min(...rates) : null,
  };
}

export function recordedFlightToJournalFlight(
  source: RecordedFlight,
  options: Readonly<{ recovered?: boolean; balloonRegistration?: string }> = {},
): CompletionJournalFlight {
  const endedAt = source.endedAt ?? source.points.at(-1)?.timestamp ?? source.updatedAt;
  const summary = calculateRecordedFlightSummary(source.points, source.startedAt, endedAt);
  const date = dateLabels(source.startedAt);
  const altitudes = finiteValues(source.points.map(({ altitudeMeters }) => altitudeMeters));
  const speeds = finiteValues(source.points.map(({ speedMetersPerSecond }) => speedMetersPerSecond));
  const headings = finiteValues(source.points.map(({ headingDegrees }) => headingDegrees));
  const first = source.points[0];
  const last = source.points.at(-1);
  const directDistanceKm = first && last ? distanceBetweenRecordedPoints(first, last) / 1000 : 0;
  const rates = verticalRates(source.points);
  return {
    id: source.id,
    title: `Vol du ${date.date}`,
    departure: "Point de décollage",
    arrival: "Point d’atterrissage",
    ...date,
    balloonRegistration: options.balloonRegistration ?? source.balloonRegistration ?? "Non renseigné",
    durationMinutes: Math.max(0, Math.round(summary.durationSeconds / 60)),
    distanceKm: summary.distanceMeters / 1000,
    takeoffTime: timeLabel(source.startedAt),
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
      ...rates,
      averageHeadingDeg: average(headings),
      directDistanceKm,
    },
    points: source.points.map((point) => ({
      longitude: point.longitude,
      latitude: point.latitude,
      elapsedMinutes: Math.max(0, (point.timestamp - source.startedAt) / 60_000),
      altitudeM: point.altitudeMeters,
      speedKmh: point.speedMetersPerSecond === null ? null : point.speedMetersPerSecond * 3.6,
    })),
    logbookStatus: "PENDING",
    origin: "REAL_GPS",
    ...(options.recovered ? { recovered: true } : {}),
  };
}
