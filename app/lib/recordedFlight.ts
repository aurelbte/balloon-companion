import type {
  GeoPoint,
  GpsAppState,
  GpsPointQuality,
  GpsPointQualityReason,
} from "../types/flight.ts";
import { calculateFilteredHorizontalDistance } from "./filteredHorizontalDistance.ts";
import type { FlightWeatherSnapshot } from "./trajectory/weatherAnalysisStorage.ts";
import type { GroundCalibration } from "./groundElevation.ts";

export const RECORDED_FLIGHT_SCHEMA_VERSION = 1;

export interface RecordedFlightPoint {
  /** Timestamp d'acquisition CoreLocation/WebKit. `timestamp` conserve cette même valeur. */
  timestamp: number;
  gpsTimestamp?: number;
  receivedAt?: number;
  callbackSequence?: number;
  deliveryLatencyMs?: number;
  sameCoordinatesAsPrevious?: boolean;
  sameAltitudeAsPrevious?: boolean;
  sameGpsTimestampAsPrevious?: boolean;
  deltaGpsTimestampMs?: number;
  deltaReceivedAtMs?: number;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  speedMetersPerSecond: number | null;
  headingDegrees: number | null;
  horizontalAccuracyMeters: number | null;
  verticalAccuracyMeters: number | null;
  appState?: GpsAppState;
  lastPointTimestamp?: number;
  deltaTimeSincePreviousPoint?: number;
  resumedAfterBackground?: boolean;
  firstFixAfterResume?: boolean;
  quality?: GpsPointQuality;
  qualityReason?: GpsPointQualityReason;
  segmentId?: string;
}

export interface RecordedFlightSummary {
  durationSeconds: number;
  distanceMeters: number;
  minAltitudeMeters: number | null;
  maxAltitudeMeters: number | null;
  averageGroundSpeedMetersPerSecond: number | null;
  maxGroundSpeedMetersPerSecond: number | null;
  maximumClimbRateMetersPerSecond?: number | null;
  maximumDescentRateMetersPerSecond?: number | null;
}

export const MAX_GAP_SPEED_MS = 20;

export interface FlightGapDistanceLink {
  gapNumber: number;
  fromSegmentId: string;
  toSegmentId: string;
  distanceMeters: number;
  durationMilliseconds: number;
  implicitSpeedMetersPerSecond: number | null;
  retained: boolean;
  reason: "PLAUSIBLE_SPEED" | "INVALID_POINT" | "UNCLASSIFIED_POINT" | "NON_POSITIVE_DURATION" | "SPEED_ABOVE_LIMIT";
}

export function calculateFlightGapDistanceLinks(
  points: readonly RecordedFlightPoint[],
  maxGapSpeedMetersPerSecond = MAX_GAP_SPEED_MS,
): FlightGapDistanceLink[] {
  const links: FlightGapDistanceLink[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (
      previous.segmentId === undefined ||
      current.segmentId === undefined ||
      previous.segmentId === current.segmentId
    ) continue;
    const distanceMeters = distanceBetweenRecordedPoints(previous, current);
    const durationMilliseconds = current.timestamp - previous.timestamp;
    const implicitSpeedMetersPerSecond = durationMilliseconds > 0
      ? distanceMeters / (durationMilliseconds / 1_000)
      : null;
    const invalidBoundary = previous.quality === "INVALID" || current.quality === "INVALID";
    const classifiedBoundary =
      (previous.quality === "VALID" || previous.quality === "SUSPECT") &&
      (current.quality === "VALID" || current.quality === "SUSPECT");
    const retained = !invalidBoundary && classifiedBoundary &&
      implicitSpeedMetersPerSecond !== null &&
      implicitSpeedMetersPerSecond <= maxGapSpeedMetersPerSecond;
    links.push({
      gapNumber: links.length + 1,
      fromSegmentId: previous.segmentId,
      toSegmentId: current.segmentId,
      distanceMeters,
      durationMilliseconds,
      implicitSpeedMetersPerSecond,
      retained,
      reason: invalidBoundary
        ? "INVALID_POINT"
        : !classifiedBoundary
          ? "UNCLASSIFIED_POINT"
        : implicitSpeedMetersPerSecond === null
          ? "NON_POSITIVE_DURATION"
          : retained ? "PLAUSIBLE_SPEED" : "SPEED_ABOVE_LIMIT",
    });
  }
  return links;
}

export interface RecordedFlight {
  id: string;
  schemaVersion: number;
  status: "RECORDING" | "COMPLETED" | "INTERRUPTED";
  startedAt: number;
  endedAt: number | null;
  points: RecordedFlightPoint[];
  summary: RecordedFlightSummary;
  createdAt: number;
  updatedAt: number;
  balloonRegistration?: string;
  weatherModel?: string;
  weatherSnapshot?: FlightWeatherSnapshot;
  groundCalibration?: GroundCalibration;
  startLocationLabel?: string;
  endLocationLabel?: string;
  generatedTitle?: string;
}

export type PointRejectionReason =
  | "INVALID_COORDINATES"
  | "INVALID_TIMESTAMP"
  | "INACCURATE"
  | "OLDER_TIMESTAMP"
  | "STRICT_DUPLICATE"
  | "IMPOSSIBLE_JUMP";

export interface PointAcceptance {
  accepted: boolean;
  reason: PointRejectionReason | null;
}

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_HORIZONTAL_ACCURACY_METERS = 100;
const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 200 / 3.6;
const JUMP_TOLERANCE_METERS = 300;
const STATIONARY_SPEED_METERS_PER_SECOND = 1.5 / 3.6;
const MIN_DISTANCE_NOISE_METERS = 8;

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function geoPointToRecordedFlightPoint(
  point: GeoPoint,
): RecordedFlightPoint {
  return {
    timestamp: point.timestamp,
    latitude: point.latitude,
    longitude: point.longitude,
    altitudeMeters: finiteOrNull(point.altitude),
    speedMetersPerSecond: finiteOrNull(point.speed),
    headingDegrees: finiteOrNull(point.heading),
    horizontalAccuracyMeters: finiteOrNull(point.accuracy),
    verticalAccuracyMeters: finiteOrNull(point.verticalAccuracy),
    ...(point.gpsTimestamp === undefined ? {} : { gpsTimestamp: point.gpsTimestamp }),
    ...(point.receivedAt === undefined ? {} : { receivedAt: point.receivedAt }),
    ...(point.callbackSequence === undefined ? {} : { callbackSequence: point.callbackSequence }),
    ...(point.deliveryLatencyMs === undefined ? {} : { deliveryLatencyMs: point.deliveryLatencyMs }),
    ...(point.sameCoordinatesAsPrevious === undefined ? {} : { sameCoordinatesAsPrevious: point.sameCoordinatesAsPrevious }),
    ...(point.sameAltitudeAsPrevious === undefined ? {} : { sameAltitudeAsPrevious: point.sameAltitudeAsPrevious }),
    ...(point.sameGpsTimestampAsPrevious === undefined ? {} : { sameGpsTimestampAsPrevious: point.sameGpsTimestampAsPrevious }),
    ...(point.deltaGpsTimestampMs === undefined ? {} : { deltaGpsTimestampMs: point.deltaGpsTimestampMs }),
    ...(point.deltaReceivedAtMs === undefined ? {} : { deltaReceivedAtMs: point.deltaReceivedAtMs }),
    ...(point.appState === undefined ? {} : { appState: point.appState }),
    ...(point.lastPointTimestamp === undefined ? {} : { lastPointTimestamp: point.lastPointTimestamp }),
    ...(point.deltaTimeSincePreviousPoint === undefined ? {} : { deltaTimeSincePreviousPoint: point.deltaTimeSincePreviousPoint }),
    ...(point.resumedAfterBackground === undefined ? {} : { resumedAfterBackground: point.resumedAfterBackground }),
    ...(point.firstFixAfterResume === undefined ? {} : { firstFixAfterResume: point.firstFixAfterResume }),
  };
}

export function recordedFlightPointToGeoPoint(
  point: RecordedFlightPoint,
): GeoPoint {
  return {
    timestamp: point.timestamp,
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitudeMeters,
    speed: point.speedMetersPerSecond,
    heading: point.headingDegrees,
    accuracy: point.horizontalAccuracyMeters,
    verticalAccuracy: point.verticalAccuracyMeters,
    ...(point.gpsTimestamp === undefined ? {} : { gpsTimestamp: point.gpsTimestamp }),
    ...(point.receivedAt === undefined ? {} : { receivedAt: point.receivedAt }),
    ...(point.callbackSequence === undefined ? {} : { callbackSequence: point.callbackSequence }),
    ...(point.deliveryLatencyMs === undefined ? {} : { deliveryLatencyMs: point.deliveryLatencyMs }),
    ...(point.sameCoordinatesAsPrevious === undefined ? {} : { sameCoordinatesAsPrevious: point.sameCoordinatesAsPrevious }),
    ...(point.sameAltitudeAsPrevious === undefined ? {} : { sameAltitudeAsPrevious: point.sameAltitudeAsPrevious }),
    ...(point.sameGpsTimestampAsPrevious === undefined ? {} : { sameGpsTimestampAsPrevious: point.sameGpsTimestampAsPrevious }),
    ...(point.deltaGpsTimestampMs === undefined ? {} : { deltaGpsTimestampMs: point.deltaGpsTimestampMs }),
    ...(point.deltaReceivedAtMs === undefined ? {} : { deltaReceivedAtMs: point.deltaReceivedAtMs }),
    ...(point.appState === undefined ? {} : { appState: point.appState }),
    ...(point.lastPointTimestamp === undefined ? {} : { lastPointTimestamp: point.lastPointTimestamp }),
    ...(point.deltaTimeSincePreviousPoint === undefined ? {} : { deltaTimeSincePreviousPoint: point.deltaTimeSincePreviousPoint }),
    ...(point.resumedAfterBackground === undefined ? {} : { resumedAfterBackground: point.resumedAfterBackground }),
    ...(point.firstFixAfterResume === undefined ? {} : { firstFixAfterResume: point.firstFixAfterResume }),
  };
}

export function distanceBetweenRecordedPoints(
  first: Pick<RecordedFlightPoint, "latitude" | "longitude">,
  second: Pick<RecordedFlightPoint, "latitude" | "longitude">,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function recordedFlightSegmentDistance(
  first: RecordedFlightPoint,
  second: RecordedFlightPoint,
): number {
  const distanceMeters = distanceBetweenRecordedPoints(first, second);
  const speedIsKnown =
    first.speedMetersPerSecond !== null &&
    second.speedMetersPerSecond !== null;
  const stationary =
    speedIsKnown &&
    Math.max(
      Math.abs(first.speedMetersPerSecond!),
      Math.abs(second.speedMetersPerSecond!),
    ) < STATIONARY_SPEED_METERS_PER_SECOND;
  const accuracyNoiseMeters = Math.max(
    first.horizontalAccuracyMeters ?? 0,
    second.horizontalAccuracyMeters ?? 0,
    MIN_DISTANCE_NOISE_METERS,
  );
  return stationary && distanceMeters <= accuracyNoiseMeters
    ? 0
    : distanceMeters;
}

export function canAppendRecordedFlightPoint(
  point: RecordedFlightPoint,
  previous: RecordedFlightPoint | null,
): PointAcceptance {
  if (
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    return { accepted: false, reason: "INVALID_COORDINATES" };
  }
  if (!Number.isFinite(point.timestamp)) {
    return { accepted: false, reason: "INVALID_TIMESTAMP" };
  }
  if (
    point.horizontalAccuracyMeters !== null &&
    (!Number.isFinite(point.horizontalAccuracyMeters) ||
      point.horizontalAccuracyMeters > MAX_HORIZONTAL_ACCURACY_METERS)
  ) {
    return { accepted: false, reason: "INACCURATE" };
  }
  if (!previous) return { accepted: true, reason: null };
  if (point.timestamp < previous.timestamp) {
    return { accepted: false, reason: "OLDER_TIMESTAMP" };
  }
  if (
    point.timestamp === previous.timestamp &&
    point.latitude === previous.latitude &&
    point.longitude === previous.longitude
  ) {
    return { accepted: false, reason: "STRICT_DUPLICATE" };
  }

  const elapsedSeconds = (point.timestamp - previous.timestamp) / 1000;
  const distanceMeters = distanceBetweenRecordedPoints(previous, point);
  const accuracyAllowance =
    (previous.horizontalAccuracyMeters ?? 0) +
    (point.horizontalAccuracyMeters ?? 0);
  const plausibleDistance = Math.max(
    JUMP_TOLERANCE_METERS,
    elapsedSeconds * MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND +
      accuracyAllowance,
  );
  if (elapsedSeconds <= 0 || distanceMeters > plausibleDistance) {
    return { accepted: false, reason: "IMPOSSIBLE_JUMP" };
  }
  return { accepted: true, reason: null };
}

export function emptyRecordedFlightSummary(): RecordedFlightSummary {
  return {
    durationSeconds: 0,
    distanceMeters: 0,
    minAltitudeMeters: null,
    maxAltitudeMeters: null,
    averageGroundSpeedMetersPerSecond: null,
    maxGroundSpeedMetersPerSecond: null,
  };
}

export function calculateRecordedFlightSummary(
  points: RecordedFlightPoint[],
  startedAt: number,
  endedAt: number | null,
): RecordedFlightSummary {
  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    distanceMeters += recordedFlightSegmentDistance(
      points[index - 1],
      points[index],
    );
  }
  const altitudes = points
    .map((point) => point.altitudeMeters)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const speeds = points
    .map((point) => point.speedMetersPerSecond)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const durationSeconds = Math.max(
    0,
    ((endedAt ?? points.at(-1)?.timestamp ?? startedAt) - startedAt) / 1000,
  );
  const measuredDurationSeconds =
    points.length >= 2
      ? Math.max(0, (points.at(-1)!.timestamp - points[0].timestamp) / 1000)
      : 0;

  return {
    durationSeconds,
    distanceMeters,
    minAltitudeMeters: altitudes.length > 0 ? Math.min(...altitudes) : null,
    maxAltitudeMeters: altitudes.length > 0 ? Math.max(...altitudes) : null,
    averageGroundSpeedMetersPerSecond:
      measuredDurationSeconds > 0
        ? distanceMeters / measuredDurationSeconds
        : null,
    maxGroundSpeedMetersPerSecond:
      speeds.length > 0 ? Math.max(...speeds) : null,
  };
}

function medianPositiveIntervalMilliseconds(points: readonly RecordedFlightPoint[]): number | null {
  const intervals: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index].timestamp - points[index - 1].timestamp;
    if (delta > 0) intervals.push(delta);
  }
  if (intervals.length === 0) return null;
  intervals.sort((left, right) => left - right);
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[middle - 1] + intervals[middle]) / 2
    : intervals[middle];
}

function validStatisticSegments(points: readonly RecordedFlightPoint[]): RecordedFlightPoint[][] {
  const segmented = points.some(({ segmentId }) => segmentId !== undefined);
  if (segmented) {
    const segments: RecordedFlightPoint[][] = [];
    let current: RecordedFlightPoint[] = [];
    let currentId: string | undefined;
    for (const point of points) {
      const valid = point.quality === undefined || point.quality === "VALID";
      if (!valid || (current.length > 0 && point.segmentId !== currentId)) {
        if (current.length > 0) segments.push(current);
        current = [];
      }
      if (valid) {
        currentId = point.segmentId;
        current.push(point);
      }
    }
    if (current.length > 0) segments.push(current);
    return segments;
  }
  const normalInterval = medianPositiveIntervalMilliseconds(points) ?? 1_000;
  const longGapThreshold = Math.max(10_000, normalInterval * 4);
  const segments: RecordedFlightPoint[][] = [];
  let current: RecordedFlightPoint[] = [];

  points.forEach((point, index) => {
    const previousRaw = index > 0 ? points[index - 1] : undefined;
    const valid = point.quality === undefined || point.quality === "VALID";
    const separated = previousRaw !== undefined && (
      point.timestamp - previousRaw.timestamp > longGapThreshold ||
      point.appState === "RESUME" ||
      point.firstFixAfterResume === true ||
      point.qualityReason === "TIME_GAP" ||
      point.qualityReason === "BACKGROUND_RESUME"
    );
    if (!valid || separated || (current.length > 0 && previousRaw !== current.at(-1))) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    if (valid) current.push(point);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function sustainedVerticalRates(
  segments: readonly RecordedFlightPoint[][],
  windowMilliseconds: number,
): number[] {
  const rates: number[] = [];
  for (const segment of segments) {
    for (let startIndex = 0; startIndex < segment.length - 2; startIndex += 1) {
      const start = segment[startIndex];
      if (start.altitudeMeters === null) continue;
      for (let endIndex = startIndex + 2; endIndex < segment.length; endIndex += 1) {
        const end = segment[endIndex];
        const elapsed = end.timestamp - start.timestamp;
        if (elapsed < windowMilliseconds) continue;
        if (end.altitudeMeters !== null && elapsed > 0) {
          rates.push((end.altitudeMeters - start.altitudeMeters) / (elapsed / 1_000));
        }
        break;
      }
    }
  }
  return rates;
}

/**
 * Recalcul pur des statistiques finales. Pour compatibilité, un point ancien
 * sans champ quality est traité comme VALID.
 */
export function recalculateFlightStatistics(
  points: readonly RecordedFlightPoint[],
  startedAt = points[0]?.timestamp ?? 0,
  endedAt: number | null = points.at(-1)?.timestamp ?? null,
  options: Readonly<{ maxGapSpeedMetersPerSecond?: number }> = {},
): RecordedFlightSummary {
  const segments = validStatisticSegments(points);
  const validPoints = segments.flat();
  const horizontalDistance = calculateFilteredHorizontalDistance(points);
  const segmentDistanceMeters = horizontalDistance.filteredDistanceMeters;
  let connectedDurationSeconds = 0;
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      connectedDurationSeconds += Math.max(0, (segment[index].timestamp - segment[index - 1].timestamp) / 1_000);
    }
  }
  const gapDistanceMeters = calculateFlightGapDistanceLinks(
    points,
    options.maxGapSpeedMetersPerSecond ?? MAX_GAP_SPEED_MS,
  ).filter(({ retained }) => retained)
    .reduce((total, { distanceMeters }) => total + distanceMeters, 0);
  const altitudes = validPoints
    .map(({ altitudeMeters }) => altitudeMeters)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const speeds = validPoints
    .map(({ speedMetersPerSecond }) => speedMetersPerSecond)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const normalInterval = medianPositiveIntervalMilliseconds(validPoints) ?? 1_000;
  const varioWindowMilliseconds = Math.min(5_000, Math.max(3_000, normalInterval * 3));
  const rates = sustainedVerticalRates(segments, varioWindowMilliseconds);
  return {
    durationSeconds: Math.max(0, ((endedAt ?? validPoints.at(-1)?.timestamp ?? startedAt) - startedAt) / 1_000),
    distanceMeters: segmentDistanceMeters + gapDistanceMeters,
    minAltitudeMeters: altitudes.length > 0 ? Math.min(...altitudes) : null,
    maxAltitudeMeters: altitudes.length > 0 ? Math.max(...altitudes) : null,
    averageGroundSpeedMetersPerSecond:
      connectedDurationSeconds > 0 ? segmentDistanceMeters / connectedDurationSeconds : null,
    maxGroundSpeedMetersPerSecond: speeds.length > 0 ? Math.max(...speeds) : null,
    maximumClimbRateMetersPerSecond: rates.length > 0 ? Math.max(...rates) : null,
    maximumDescentRateMetersPerSecond: rates.length > 0 ? Math.min(...rates) : null,
  };
}

function createFlightId(now: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `flight-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRecordedFlight({
  startedAt = Date.now(),
  id = createFlightId(startedAt),
  firstPoint = null,
  balloonRegistration,
  weatherModel,
  weatherSnapshot,
}: {
  startedAt?: number;
  id?: string;
  firstPoint?: RecordedFlightPoint | null;
  balloonRegistration?: string;
  weatherModel?: string;
  weatherSnapshot?: FlightWeatherSnapshot;
} = {}): RecordedFlight {
  const points =
    firstPoint && canAppendRecordedFlightPoint(firstPoint, null).accepted
      ? [firstPoint]
      : [];
  return {
    id,
    schemaVersion: RECORDED_FLIGHT_SCHEMA_VERSION,
    status: "RECORDING",
    startedAt,
    endedAt: null,
    points,
    summary: calculateRecordedFlightSummary(points, startedAt, null),
    createdAt: startedAt,
    updatedAt: startedAt,
    ...(balloonRegistration ? { balloonRegistration } : {}),
    ...(weatherModel ? { weatherModel } : {}),
    ...(weatherSnapshot ? { weatherSnapshot } : {}),
  };
}

export function appendRecordedFlightPoint(
  flight: RecordedFlight,
  point: RecordedFlightPoint,
): { flight: RecordedFlight; acceptance: PointAcceptance } {
  const acceptance = canAppendRecordedFlightPoint(
    point,
    flight.points.at(-1) ?? null,
  );
  if (!acceptance.accepted) return { flight, acceptance };
  const points = [...flight.points, point];
  return {
    acceptance,
    flight: {
      ...flight,
      points,
      updatedAt: Math.max(flight.updatedAt, point.timestamp),
    },
  };
}

export function interruptRecordedFlight(
  flight: RecordedFlight,
  now = Date.now(),
): RecordedFlight {
  return {
    ...flight,
    status: "INTERRUPTED",
    summary: calculateRecordedFlightSummary(
      flight.points,
      flight.startedAt,
      null,
    ),
    updatedAt: now,
  };
}

export function resumeRecordedFlight(
  flight: RecordedFlight,
  now = Date.now(),
): RecordedFlight {
  return { ...flight, status: "RECORDING", endedAt: null, updatedAt: now };
}

export function finalizeRecordedFlight(
  flight: RecordedFlight,
  endedAt = Date.now(),
): RecordedFlight {
  let summary = flight.summary;
  try {
    summary = recalculateFlightStatistics(
      flight.points,
      flight.startedAt,
      endedAt,
    );
  } catch {
    // La finalisation ne doit jamais perdre la trace si un calcul échoue.
  }
  return {
    ...flight,
    status: "COMPLETED",
    endedAt,
    summary,
    updatedAt: endedAt,
  };
}
