import {
  recordedFlightSegmentDistance,
  type RecordedFlightPoint,
} from "./recordedFlight.ts";

export type FlightSegmentBreakReason =
  | "TIME_GAP"
  | "BACKGROUND"
  | "INVALID_POINT"
  | "LOW_ACCURACY"
  | "AUTRE";

export interface FlightSegment {
  id: string;
  breakReason: FlightSegmentBreakReason | null;
  points: RecordedFlightPoint[];
  startedAt: number;
  endedAt: number;
  durationMilliseconds: number;
  distanceMeters: number;
  minAltitudeMeters: number | null;
  maxAltitudeMeters: number | null;
}

export interface FlightSegmentationOptions {
  gapMilliseconds?: number;
}

const DEFAULT_GAP_MILLISECONDS = 8_000;

function breakReason(
  previous: RecordedFlightPoint,
  current: RecordedFlightPoint,
  gapMilliseconds: number,
): FlightSegmentBreakReason | null {
  if (current.quality === "INVALID") return "INVALID_POINT";
  if (
    current.firstFixAfterResume === true &&
    (current.qualityReason === "LOW_ACCURACY" || current.horizontalAccuracyMeters === null || current.horizontalAccuracyMeters > 50)
  ) return "LOW_ACCURACY";
  if (
    current.appState === "RESUME" ||
    current.firstFixAfterResume === true ||
    current.qualityReason === "BACKGROUND_RESUME"
  ) return "BACKGROUND";
  const delta = current.deltaTimeSincePreviousPoint ?? current.timestamp - previous.timestamp;
  if (delta >= gapMilliseconds || current.qualityReason === "TIME_GAP") return "TIME_GAP";
  return null;
}

function summarizeSegment(
  id: string,
  reason: FlightSegmentBreakReason | null,
  points: RecordedFlightPoint[],
): FlightSegment {
  const statisticPoints = points.filter(({ quality }) => quality === undefined || quality === "VALID");
  let distanceMeters = 0;
  for (let index = 1; index < statisticPoints.length; index += 1) {
    const previous = statisticPoints[index - 1];
    const current = statisticPoints[index];
    const previousIndex = points.indexOf(previous);
    if (points[previousIndex + 1] === current) {
      distanceMeters += recordedFlightSegmentDistance(previous, current);
    }
  }
  const altitudes = statisticPoints
    .map(({ altitudeMeters }) => altitudeMeters)
    .filter((altitude): altitude is number => altitude !== null && Number.isFinite(altitude));
  const startedAt = points[0]?.timestamp ?? 0;
  const endedAt = points.at(-1)?.timestamp ?? startedAt;
  return {
    id,
    breakReason: reason,
    points,
    startedAt,
    endedAt,
    durationMilliseconds: Math.max(0, endedAt - startedAt),
    distanceMeters,
    minAltitudeMeters: altitudes.length > 0 ? Math.min(...altitudes) : null,
    maxAltitudeMeters: altitudes.length > 0 ? Math.max(...altitudes) : null,
  };
}

export function buildFlightSegments(
  points: readonly RecordedFlightPoint[],
  options: FlightSegmentationOptions = {},
): FlightSegment[] {
  if (points.length === 0) return [];
  const gapMilliseconds = options.gapMilliseconds ?? DEFAULT_GAP_MILLISECONDS;
  const segments: FlightSegment[] = [];
  let segmentNumber = 1;
  let reason: FlightSegmentBreakReason | null = null;
  let current: RecordedFlightPoint[] = [];

  points.forEach((point, index) => {
    const nextReason = index === 0
      ? null
      : breakReason(points[index - 1], point, gapMilliseconds);
    if (nextReason !== null && current.length > 0) {
      segments.push(summarizeSegment(`segment-${segmentNumber}`, reason, current));
      segmentNumber += 1;
      reason = nextReason;
      current = [];
    }
    current.push({ ...point, segmentId: `segment-${segmentNumber}` });
  });
  if (current.length > 0) {
    segments.push(summarizeSegment(`segment-${segmentNumber}`, reason, current));
  }
  return segments;
}

export function assignFlightSegmentIds(points: readonly RecordedFlightPoint[]): RecordedFlightPoint[] {
  return buildFlightSegments(points).flatMap(({ points: segmentPoints }) => segmentPoints);
}
