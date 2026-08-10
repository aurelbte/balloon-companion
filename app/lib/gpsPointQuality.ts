import type { GpsPointQuality, GpsPointQualityReason } from "../types/flight.ts";
import type { RecordedFlightPoint } from "./recordedFlight.ts";
import { distanceBetweenRecordedPoints } from "./recordedFlight.ts";

export interface GpsPointQualityClassification {
  quality: GpsPointQuality;
  reason: GpsPointQualityReason;
}

const VALID: GpsPointQualityClassification = { quality: "VALID", reason: "NONE" };
const LOW_ACCURACY_METERS = 50;
const ALTITUDE_SPIKE_METERS_PER_SECOND = 10;
const SUSTAINED_ALTITUDE_SECONDS = 5;
const SPEED_OUTLIER_METERS_PER_SECOND = 30;
const SUSTAINED_SPEED_SECONDS = 15;

function positiveDeltaSeconds(first: RecordedFlightPoint, second: RecordedFlightPoint): number | null {
  const delta = (second.timestamp - first.timestamp) / 1_000;
  return delta > 0 ? delta : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function normalIntervalMilliseconds(points: readonly RecordedFlightPoint[]): number | null {
  const intervals = points.slice(-6).flatMap((point, index, recent) => {
    if (index === 0) return [];
    const delta = point.timestamp - recent[index - 1].timestamp;
    return delta > 0 ? [delta] : [];
  });
  return median(intervals);
}

function isIsolatedPositionJump(
  previous: RecordedFlightPoint,
  current: RecordedFlightPoint,
  next: RecordedFlightPoint | undefined,
): boolean {
  if (!next) return false;
  const incoming = distanceBetweenRecordedPoints(previous, current);
  const outgoing = distanceBetweenRecordedPoints(current, next);
  const bypass = distanceBetweenRecordedPoints(previous, next);
  const accuracyAllowance =
    (previous.horizontalAccuracyMeters ?? 0) +
    (current.horizontalAccuracyMeters ?? 0) +
    (next.horizontalAccuracyMeters ?? 0);
  return incoming > 300 + accuracyAllowance &&
    outgoing > 300 + accuracyAllowance &&
    bypass <= 100 + accuracyAllowance;
}

function isUnconfirmedPositionJump(
  previous: RecordedFlightPoint,
  current: RecordedFlightPoint,
): boolean {
  const elapsed = positiveDeltaSeconds(previous, current);
  if (elapsed === null) return false;
  const distance = distanceBetweenRecordedPoints(previous, current);
  const measuredSpeed = distance / elapsed;
  const reportedSpeed = Math.max(
    previous.speedMetersPerSecond ?? 0,
    current.speedMetersPerSecond ?? 0,
  );
  const accuracyAllowance =
    (previous.horizontalAccuracyMeters ?? 0) +
    (current.horizontalAccuracyMeters ?? 0);
  return distance > 300 + accuracyAllowance && measuredSpeed > Math.max(30, reportedSpeed * 3);
}

function verticalRate(first: RecordedFlightPoint, second: RecordedFlightPoint): number | null {
  const elapsed = positiveDeltaSeconds(first, second);
  if (elapsed === null || first.altitudeMeters === null || second.altitudeMeters === null) return null;
  return (second.altitudeMeters - first.altitudeMeters) / elapsed;
}

function altitudeSpikeIsSustained(
  previousPoints: readonly RecordedFlightPoint[],
  currentPoint: RecordedFlightPoint,
  followingPoints: readonly RecordedFlightPoint[],
): boolean {
  const sequence = [...previousPoints.slice(-4), currentPoint, ...followingPoints.slice(0, 4)];
  const currentIndex = Math.min(previousPoints.length, 4);
  const incoming = currentIndex > 0 ? verticalRate(sequence[currentIndex - 1], sequence[currentIndex]) : null;
  if (incoming === null || Math.abs(incoming) <= ALTITUDE_SPIKE_METERS_PER_SECOND) return false;
  const sign = Math.sign(incoming);
  let firstTimestamp = sequence[currentIndex - 1].timestamp;
  let lastTimestamp = sequence[currentIndex].timestamp;
  for (let index = currentIndex - 1; index > 0; index -= 1) {
    const rate = verticalRate(sequence[index - 1], sequence[index]);
    if (rate === null || Math.sign(rate) !== sign || Math.abs(rate) < ALTITUDE_SPIKE_METERS_PER_SECOND / 2) break;
    firstTimestamp = sequence[index - 1].timestamp;
  }
  for (let index = currentIndex + 1; index < sequence.length; index += 1) {
    const rate = verticalRate(sequence[index - 1], sequence[index]);
    if (rate === null || Math.sign(rate) !== sign || Math.abs(rate) < ALTITUDE_SPIKE_METERS_PER_SECOND / 2) break;
    lastTimestamp = sequence[index].timestamp;
  }
  return lastTimestamp - firstTimestamp >= SUSTAINED_ALTITUDE_SECONDS * 1_000;
}

function speedOutlierIsSustained(
  previousPoints: readonly RecordedFlightPoint[],
  currentPoint: RecordedFlightPoint,
  followingPoints: readonly RecordedFlightPoint[],
): boolean {
  const sequence = [...previousPoints.slice(-12), currentPoint, ...followingPoints.slice(0, 12)];
  const highSpeedPoints = sequence.filter(
    (point) => (point.speedMetersPerSecond ?? 0) >= SPEED_OUTLIER_METERS_PER_SECOND * 0.8,
  );
  if (highSpeedPoints.length < 2) return false;
  return highSpeedPoints.at(-1)!.timestamp - highSpeedPoints[0].timestamp >= SUSTAINED_SPEED_SECONDS * 1_000;
}

function headingDelta(first: number, second: number): number {
  const delta = Math.abs(first - second) % 360;
  return Math.min(delta, 360 - delta);
}

export function classifyGpsPointQuality(
  previousPoints: readonly RecordedFlightPoint[],
  currentPoint: RecordedFlightPoint,
  followingPoints: readonly RecordedFlightPoint[] = [],
): GpsPointQualityClassification {
  const previous = previousPoints.at(-1);
  const next = followingPoints[0];

  if (previous && isIsolatedPositionJump(previous, currentPoint, next)) {
    return { quality: "INVALID", reason: "POSITION_JUMP" };
  }
  if ((currentPoint.horizontalAccuracyMeters ?? 0) > LOW_ACCURACY_METERS) {
    return { quality: "SUSPECT", reason: "LOW_ACCURACY" };
  }
  if (currentPoint.firstFixAfterResume || currentPoint.appState === "RESUME") {
    return { quality: "SUSPECT", reason: "BACKGROUND_RESUME" };
  }
  if (previous) {
    const delta = currentPoint.deltaTimeSincePreviousPoint ?? currentPoint.timestamp - previous.timestamp;
    const normal = normalIntervalMilliseconds(previousPoints);
    if (delta > Math.max(10_000, (normal ?? 1_000) * 4)) {
      return { quality: "SUSPECT", reason: "TIME_GAP" };
    }
    if (isUnconfirmedPositionJump(previous, currentPoint)) {
      return { quality: "SUSPECT", reason: "POSITION_JUMP" };
    }
    const rate = verticalRate(previous, currentPoint);
    if (rate !== null && Math.abs(rate) > ALTITUDE_SPIKE_METERS_PER_SECOND &&
        !altitudeSpikeIsSustained(previousPoints, currentPoint, followingPoints)) {
      return { quality: "SUSPECT", reason: "ALTITUDE_SPIKE" };
    }
    if ((currentPoint.speedMetersPerSecond ?? 0) > SPEED_OUTLIER_METERS_PER_SECOND &&
        !speedOutlierIsSustained(previousPoints, currentPoint, followingPoints)) {
      return { quality: "SUSPECT", reason: "SPEED_OUTLIER" };
    }
    if (previous.headingDegrees !== null && currentPoint.headingDegrees !== null &&
        headingDelta(previous.headingDegrees, currentPoint.headingDegrees) > 150 &&
        Math.abs((currentPoint.speedMetersPerSecond ?? 0) - (previous.speedMetersPerSecond ?? 0)) > 10) {
      return { quality: "SUSPECT", reason: "HEADING_OUTLIER" };
    }
  }
  return VALID;
}

export function classifyGpsTraceQuality(
  points: readonly RecordedFlightPoint[],
): RecordedFlightPoint[] {
  return points.map((point, index) => {
    const classification = classifyGpsPointQuality(
      points.slice(0, index),
      point,
      points.slice(index + 1),
    );
    return { ...point, quality: classification.quality, qualityReason: classification.reason };
  });
}
