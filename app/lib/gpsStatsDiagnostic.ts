import {
  calculateRecordedFlightSummary,
  calculateFlightGapDistanceLinks,
  recalculateFlightStatistics,
  type RecordedFlight,
  type RecordedFlightPoint,
  type RecordedFlightSummary,
} from "./recordedFlight.ts";
import type { RecordedFlightStorage } from "./recordedFlightStorage.ts";
import { classifyGpsTraceQuality } from "./gpsPointQuality.ts";
import { buildFlightSegments, type FlightSegmentBreakReason } from "./flightSegments.ts";
import { calculateFilteredHorizontalDistance } from "./filteredHorizontalDistance.ts";

export interface GpsRecordDiagnostic {
  timestamp: number | null;
  windowMilliseconds: number | null;
  points: readonly RecordedFlightPoint[];
  value: number | null;
}

export interface GpsStatisticsDiagnostic {
  flightId: string;
  oldStatistics: RecordedFlightSummary & Readonly<{
    maximumClimbRateMetersPerSecond: number | null;
    maximumDescentRateMetersPerSecond: number | null;
  }>;
  newStatistics: RecordedFlightSummary;
  pointCounts: Readonly<{ total: number; valid: number; suspect: number; invalid: number }>;
  gapOrBackgroundCount: number;
  segmentCount: number;
  segments: readonly Readonly<{
    id: string;
    breakReason: FlightSegmentBreakReason | null;
    startedAt: number;
    endedAt: number;
    durationMilliseconds: number;
    pointCount: number;
    distanceMeters: number;
    minAltitudeMeters: number | null;
    maxAltitudeMeters: number | null;
  }>[];
  gapDistanceLinks: ReturnType<typeof calculateFlightGapDistanceLinks>;
  distanceDiagnostic: Readonly<{
    rawDistanceMeters: number;
    segmentedDistanceMeters: number;
    filteredDistanceMeters: number;
    gapDistanceMeters: number;
    finalDistanceMeters: number;
    removedNoiseMeters: number;
    removedPercentage: number;
    neutralizedMicroOscillations: number;
  }>;
  records: Readonly<{
    maximumSpeed: GpsRecordDiagnostic;
    maximumClimb: GpsRecordDiagnostic;
    maximumDescent: GpsRecordDiagnostic;
  }>;
}

function legacyRates(points: readonly RecordedFlightPoint[]): number[] {
  const rates: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const seconds = (current.timestamp - previous.timestamp) / 1_000;
    if (seconds > 0 && previous.altitudeMeters !== null && current.altitudeMeters !== null) {
      rates.push((current.altitudeMeters - previous.altitudeMeters) / seconds);
    }
  }
  return rates;
}

function medianInterval(points: readonly RecordedFlightPoint[]): number {
  const intervals = points.slice(1).flatMap((point, index) => {
    const delta = point.timestamp - points[index].timestamp;
    return delta > 0 ? [delta] : [];
  }).sort((left, right) => left - right);
  if (intervals.length === 0) return 1_000;
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[middle - 1] + intervals[middle]) / 2
    : intervals[middle];
}

function validSegments(points: readonly RecordedFlightPoint[]): RecordedFlightPoint[][] {
  const usesSegmentIds = points.some(({ segmentId }) => segmentId !== undefined);
  if (usesSegmentIds) {
    const segments: RecordedFlightPoint[][] = [];
    let segment: RecordedFlightPoint[] = [];
    let segmentId: string | undefined;
    for (const point of points) {
      if (point.quality !== "VALID" || (segment.length > 0 && point.segmentId !== segmentId)) {
        if (segment.length > 0) segments.push(segment);
        segment = [];
      }
      if (point.quality === "VALID") {
        segmentId = point.segmentId;
        segment.push(point);
      }
    }
    if (segment.length > 0) segments.push(segment);
    return segments;
  }
  const threshold = Math.max(10_000, medianInterval(points) * 4);
  const segments: RecordedFlightPoint[][] = [];
  let segment: RecordedFlightPoint[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const separated = previous && (
      point.timestamp - previous.timestamp > threshold ||
      point.appState === "RESUME" ||
      point.firstFixAfterResume === true ||
      point.qualityReason === "TIME_GAP" ||
      point.qualityReason === "BACKGROUND_RESUME"
    );
    if (point.quality !== "VALID" || separated || (segment.length > 0 && previous !== segment.at(-1))) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
    }
    if (point.quality === "VALID") segment.push(point);
  });
  if (segment.length > 0) segments.push(segment);
  return segments;
}

function emptyRecord(): GpsRecordDiagnostic {
  return { timestamp: null, windowMilliseconds: null, points: [], value: null };
}

function speedRecord(points: readonly RecordedFlightPoint[]): GpsRecordDiagnostic {
  const point = points.reduce<RecordedFlightPoint | null>((record, candidate) =>
    candidate.quality === "VALID" && candidate.speedMetersPerSecond !== null &&
    (record?.speedMetersPerSecond === null || record === null || candidate.speedMetersPerSecond > record.speedMetersPerSecond)
      ? candidate
      : record, null);
  return point
    ? { timestamp: point.timestamp, windowMilliseconds: 0, points: [point], value: point.speedMetersPerSecond }
    : emptyRecord();
}

function varioRecords(points: readonly RecordedFlightPoint[]): {
  maximumClimb: GpsRecordDiagnostic;
  maximumDescent: GpsRecordDiagnostic;
} {
  const validPoints = points.filter(({ quality }) => quality === "VALID");
  const windowMilliseconds = Math.min(5_000, Math.max(3_000, medianInterval(validPoints) * 3));
  let maximumClimb = emptyRecord();
  let maximumDescent = emptyRecord();
  for (const segment of validSegments(points)) {
    for (let startIndex = 0; startIndex < segment.length - 2; startIndex += 1) {
      const start = segment[startIndex];
      if (start.altitudeMeters === null) continue;
      for (let endIndex = startIndex + 2; endIndex < segment.length; endIndex += 1) {
        const end = segment[endIndex];
        const elapsed = end.timestamp - start.timestamp;
        if (elapsed < windowMilliseconds) continue;
        if (end.altitudeMeters !== null && elapsed > 0) {
          const value = (end.altitudeMeters - start.altitudeMeters) / (elapsed / 1_000);
          const record = {
            timestamp: end.timestamp,
            windowMilliseconds: elapsed,
            points: segment.slice(startIndex, endIndex + 1),
            value,
          };
          if (maximumClimb.value === null || value > maximumClimb.value) maximumClimb = record;
          if (maximumDescent.value === null || value < maximumDescent.value) maximumDescent = record;
        }
        break;
      }
    }
  }
  return { maximumClimb, maximumDescent };
}

export function diagnoseRecordedFlight(flight: RecordedFlight): GpsStatisticsDiagnostic {
  const classified = classifyGpsTraceQuality(flight.points);
  const segments = buildFlightSegments(classified);
  const segmentedPoints = segments.flatMap(({ points }) => points);
  const oldBase = calculateRecordedFlightSummary(flight.points, flight.startedAt, flight.endedAt);
  const rates = legacyRates(flight.points);
  const newStatistics = recalculateFlightStatistics(segmentedPoints, flight.startedAt, flight.endedAt);
  const horizontalDistance = calculateFilteredHorizontalDistance(segmentedPoints);
  const gapDistanceLinks = calculateFlightGapDistanceLinks(segmentedPoints);
  const gapDistanceMeters = gapDistanceLinks.filter(({ retained }) => retained)
    .reduce((total, { distanceMeters }) => total + distanceMeters, 0);
  const varios = varioRecords(segmentedPoints);
  return {
    flightId: flight.id,
    oldStatistics: {
      ...oldBase,
      maximumClimbRateMetersPerSecond: rates.length > 0 ? Math.max(...rates) : null,
      maximumDescentRateMetersPerSecond: rates.length > 0 ? Math.min(...rates) : null,
    },
    newStatistics,
    pointCounts: {
      total: segmentedPoints.length,
      valid: segmentedPoints.filter(({ quality }) => quality === "VALID").length,
      suspect: segmentedPoints.filter(({ quality }) => quality === "SUSPECT").length,
      invalid: segmentedPoints.filter(({ quality }) => quality === "INVALID").length,
    },
    gapOrBackgroundCount: segments.slice(1).filter(({ breakReason }) =>
      breakReason === "TIME_GAP" || breakReason === "BACKGROUND" || breakReason === "LOW_ACCURACY").length,
    segmentCount: segments.length,
    segments: segments.map((segment) => ({
      id: segment.id,
      breakReason: segment.breakReason,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      durationMilliseconds: segment.durationMilliseconds,
      pointCount: segment.points.length,
      distanceMeters: segment.distanceMeters,
      minAltitudeMeters: segment.minAltitudeMeters,
      maxAltitudeMeters: segment.maxAltitudeMeters,
    })),
    gapDistanceLinks,
    distanceDiagnostic: {
      rawDistanceMeters: oldBase.distanceMeters,
      segmentedDistanceMeters: horizontalDistance.rawDistanceMeters,
      filteredDistanceMeters: horizontalDistance.filteredDistanceMeters,
      gapDistanceMeters,
      finalDistanceMeters: horizontalDistance.filteredDistanceMeters + gapDistanceMeters,
      removedNoiseMeters: horizontalDistance.removedNoiseMeters,
      removedPercentage: horizontalDistance.removedPercentage,
      neutralizedMicroOscillations: horizontalDistance.neutralizedMicroOscillations,
    },
    records: {
      maximumSpeed: speedRecord(segmentedPoints),
      maximumClimb: varios.maximumClimb,
      maximumDescent: varios.maximumDescent,
    },
  };
}

export async function loadGpsStatisticsDiagnostic(
  storage: RecordedFlightStorage,
  flightId?: string,
): Promise<GpsStatisticsDiagnostic | null> {
  const flight = flightId
    ? await storage.getFlight(flightId)
    : (await storage.listFlights())[0] ?? await storage.getActiveFlight();
  return flight ? diagnoseRecordedFlight(flight) : null;
}
