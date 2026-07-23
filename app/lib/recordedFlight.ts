import type { GeoPoint } from "../types/flight.ts";

export const RECORDED_FLIGHT_SCHEMA_VERSION = 1;

export interface RecordedFlightPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  speedMetersPerSecond: number | null;
  headingDegrees: number | null;
  horizontalAccuracyMeters: number | null;
  verticalAccuracyMeters: number | null;
}

export interface RecordedFlightSummary {
  durationSeconds: number;
  distanceMeters: number;
  minAltitudeMeters: number | null;
  maxAltitudeMeters: number | null;
  averageGroundSpeedMetersPerSecond: number | null;
  maxGroundSpeedMetersPerSecond: number | null;
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
}: {
  startedAt?: number;
  id?: string;
  firstPoint?: RecordedFlightPoint | null;
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
    summary = calculateRecordedFlightSummary(
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
