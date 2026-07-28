import type {
  TrajectoryProjectionResult,
  TrajectoryPoint,
} from "./types.ts";
import type { TrajectoryTimeMarker } from "./integration.ts";

const BASE_MARKER_MINUTES = [5, 10, 20, 30, 45, 60] as const;

export function isTrajectoryRenderable(
  projection: TrajectoryProjectionResult,
): boolean {
  return (
    projection.points.length >= 2 &&
    projection.points.every(
      (point) =>
        Number.isFinite(point.latitude) &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        Number.isFinite(point.longitude) &&
        point.longitude >= -180 &&
        point.longitude <= 180,
    )
  );
}

export function trajectoryToGeoJson(
  projection: TrajectoryProjectionResult,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: projection.points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      },
    ],
  };
}

export function interpolateTrajectoryPoint(
  points: readonly TrajectoryPoint[],
  elapsedSeconds: number,
): TrajectoryPoint | null {
  if (points.length === 0) return null;
  const exact = points.find(
    (point) => Math.abs(point.elapsedSeconds - elapsedSeconds) < 1e-9,
  );
  if (exact) return exact;
  const afterIndex = points.findIndex(
    (point) => point.elapsedSeconds > elapsedSeconds,
  );
  if (afterIndex <= 0) return null;
  const before = points[afterIndex - 1];
  const after = points[afterIndex];
  const ratio =
    (elapsedSeconds - before.elapsedSeconds) /
    (after.elapsedSeconds - before.elapsedSeconds);
  return {
    latitude:
      before.latitude + (after.latitude - before.latitude) * ratio,
    longitude:
      before.longitude + (after.longitude - before.longitude) * ratio,
    altitudeAmslM:
      before.altitudeAmslM +
      (after.altitudeAmslM - before.altitudeAmslM) * ratio,
    elapsedSeconds,
    timestamp: new Date(
      Date.parse(before.timestamp) +
        (Date.parse(after.timestamp) - Date.parse(before.timestamp)) *
          ratio,
    ).toISOString(),
    verticalPhase: after.verticalPhase,
  };
}

export function buildTrajectoryTimeMarkers(
  projection: TrajectoryProjectionResult,
): TrajectoryTimeMarker[] {
  const minutes: number[] = [...BASE_MARKER_MINUTES];
  for (let minute = 90; minute * 60 <= projection.durationSeconds; minute += 30) {
    minutes.push(minute);
  }
  return minutes.flatMap((minute) => {
    const elapsedSeconds = minute * 60;
    if (elapsedSeconds > projection.durationSeconds) return [];
    const point = interpolateTrajectoryPoint(
      projection.points,
      elapsedSeconds,
    );
    return point
      ? [
          {
            minutes: minute,
            elapsedSeconds,
            latitude: point.latitude,
            longitude: point.longitude,
            altitudeAmslM: point.altitudeAmslM,
          },
        ]
      : [];
  });
}

export function trajectoryBounds(
  projection: TrajectoryProjectionResult,
): [[number, number], [number, number]] {
  const longitudes = projection.points.map((point) => point.longitude);
  const latitudes = projection.points.map((point) => point.latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
