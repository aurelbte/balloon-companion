import type { GeoPoint } from "../types/flight.ts";
import type {
  FlightContextGpsStatus,
  LoadedAirspaceCoverage,
} from "./flightContext.ts";
import type { AirspaceFeatureCollection } from "./openaip.ts";

export interface FlightContextEvaluationSnapshot {
  position: GeoPoint | null;
  gpsStatus: FlightContextGpsStatus;
  airspaceVersion: string;
  coverageVersion: string;
  airspaceDataAvailable: boolean;
}

function altitudeLimitVersion(
  limit: {
    value: number;
    unit: number;
    referenceDatum: number;
  } | null,
): string {
  return limit
    ? `${limit.value}:${limit.unit}:${limit.referenceDatum}`
    : "-";
}

export function getAirspaceEvaluationVersion(
  airspaces: AirspaceFeatureCollection,
): string {
  return airspaces.features
    .map(({ properties }) =>
      [
        properties.airspaceId,
        properties.type,
        properties.icaoClass ?? "-",
        altitudeLimitVersion(properties.lowerLimit),
        altitudeLimitVersion(properties.upperLimit),
      ].join(":"),
    )
    .sort()
    .join("|");
}

export function getCoverageEvaluationVersion(
  coverage: LoadedAirspaceCoverage[],
): string {
  return coverage
    .map(
      (item) =>
        `${item.latitude.toFixed(5)}:${item.longitude.toFixed(5)}:${Math.round(item.radiusMeters)}`,
    )
    .sort()
    .join("|");
}

export function shouldUpdateFlightContext(
  previous: FlightContextEvaluationSnapshot,
  next: FlightContextEvaluationSnapshot,
): boolean {
  if (
    previous.gpsStatus !== next.gpsStatus ||
    previous.airspaceVersion !== next.airspaceVersion ||
    previous.coverageVersion !== next.coverageVersion ||
    previous.airspaceDataAvailable !== next.airspaceDataAvailable
  ) {
    return true;
  }
  if (!previous.position || !next.position) {
    return previous.position !== next.position;
  }

  const latitudeMeters =
    (next.position.latitude - previous.position.latitude) * 111_320;
  const longitudeMeters =
    (next.position.longitude - previous.position.longitude) *
    111_320 *
    Math.cos((previous.position.latitude * Math.PI) / 180);
  const horizontalMovementMeters = Math.hypot(
    latitudeMeters,
    longitudeMeters,
  );
  const horizontalThresholdMeters = Math.max(
    25,
    previous.position.accuracy ?? 0,
    next.position.accuracy ?? 0,
  );
  const previousAltitude = previous.position.altitude;
  const nextAltitude = next.position.altitude;
  const altitudeChanged =
    previousAltitude === null || nextAltitude === null
      ? previousAltitude !== nextAltitude
      : Math.abs(nextAltitude - previousAltitude) >=
        Math.max(
          10,
          previous.position.verticalAccuracy ?? 0,
          next.position.verticalAccuracy ?? 0,
        );

  return horizontalMovementMeters >= horizontalThresholdMeters || altitudeChanged;
}
