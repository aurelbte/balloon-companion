import type { RecordedFlightPoint } from "./recordedFlight.ts";

export const HORIZONTAL_FILTER_WINDOW_MILLISECONDS = 3_000;

export interface FilteredHorizontalDistanceResult {
  rawDistanceMeters: number;
  filteredDistanceMeters: number;
  removedNoiseMeters: number;
  removedPercentage: number;
  neutralizedMicroOscillations: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const MIN_ACCURACY_METERS = 1;
const DEFAULT_ACCURACY_METERS = 5;
const STATIONARY_SPEED_METERS_PER_SECOND = 1.5 / 3.6;
const MIN_DISTANCE_NOISE_METERS = 8;

function distanceMeters(
  first: Pick<RecordedFlightPoint, "latitude" | "longitude">,
  second: Pick<RecordedFlightPoint, "latitude" | "longitude">,
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function segmentDistance(first: RecordedFlightPoint, second: RecordedFlightPoint): number {
  const distance = distanceMeters(first, second);
  const stationary = first.speedMetersPerSecond !== null && second.speedMetersPerSecond !== null &&
    Math.max(Math.abs(first.speedMetersPerSecond), Math.abs(second.speedMetersPerSecond)) < STATIONARY_SPEED_METERS_PER_SECOND;
  const uncertainty = Math.max(
    first.horizontalAccuracyMeters ?? 0,
    second.horizontalAccuracyMeters ?? 0,
    MIN_DISTANCE_NOISE_METERS,
  );
  return stationary && distance <= uncertainty ? 0 : distance;
}

function reliableRuns(points: readonly RecordedFlightPoint[]): RecordedFlightPoint[][] {
  const runs: RecordedFlightPoint[][] = [];
  let run: RecordedFlightPoint[] = [];
  let segmentId: string | undefined;
  for (const point of points) {
    const reliable = point.quality === undefined || point.quality === "VALID";
    if (!reliable || (run.length > 0 && point.segmentId !== segmentId)) {
      if (run.length > 0) runs.push(run);
      run = [];
    }
    if (reliable) {
      segmentId = point.segmentId;
      run.push(point);
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function filteredRun(run: readonly RecordedFlightPoint[]): RecordedFlightPoint[] {
  if (run.length < 3) return run.map((point) => ({ ...point }));
  const referenceLatitudeRadians = run[0].latitude * Math.PI / 180;
  const metersPerLongitudeDegree = 111_320 * Math.cos(referenceLatitudeRadians);
  const origin = run[0];
  const coordinates = run.map((point) => ({
    x: (point.longitude - origin.longitude) * metersPerLongitudeDegree,
    y: (point.latitude - origin.latitude) * 111_320,
  }));
  const radius = HORIZONTAL_FILTER_WINDOW_MILLISECONDS / 2;
  return run.map((point, pointIndex) => {
    const previous = run[pointIndex - 1];
    const next = run[pointIndex + 1];
    if (previous && next && next.timestamp - previous.timestamp <= HORIZONTAL_FILTER_WINDOW_MILLISECONDS) {
      const incomingX = coordinates[pointIndex].x - coordinates[pointIndex - 1].x;
      const incomingY = coordinates[pointIndex].y - coordinates[pointIndex - 1].y;
      const outgoingX = coordinates[pointIndex + 1].x - coordinates[pointIndex].x;
      const outgoingY = coordinates[pointIndex + 1].y - coordinates[pointIndex].y;
      const reversesDirection = incomingX * outgoingX + incomingY * outgoingY < 0;
      const detour = distanceMeters(previous, point) + distanceMeters(point, next) - distanceMeters(previous, next);
      const uncertainty = Math.max(
        previous.horizontalAccuracyMeters ?? DEFAULT_ACCURACY_METERS,
        point.horizontalAccuracyMeters ?? DEFAULT_ACCURACY_METERS,
        next.horizontalAccuracyMeters ?? DEFAULT_ACCURACY_METERS,
      );
      if (reversesDirection && detour <= uncertainty * 2) {
        const duration = next.timestamp - previous.timestamp;
        const fraction = duration > 0 ? (point.timestamp - previous.timestamp) / duration : 0.5;
        return {
          ...point,
          latitude: previous.latitude + (next.latitude - previous.latitude) * fraction,
          longitude: previous.longitude + (next.longitude - previous.longitude) * fraction,
        };
      }
    }
    const samples = run.flatMap((candidate, candidateIndex) =>
      Math.abs(candidate.timestamp - point.timestamp) <= radius
        ? [{ point: candidate, coordinate: coordinates[candidateIndex] }]
        : []);
    if (samples.length < 3) return { ...point };
    const weighted = samples.map((sample) => {
      const accuracy = Math.max(sample.point.horizontalAccuracyMeters ?? DEFAULT_ACCURACY_METERS, MIN_ACCURACY_METERS);
      return { ...sample, t: (sample.point.timestamp - point.timestamp) / 1_000, weight: 1 / (accuracy ** 2) };
    });
    const weightSum = weighted.reduce((sum, sample) => sum + sample.weight, 0);
    const meanTime = weighted.reduce((sum, sample) => sum + sample.t * sample.weight, 0) / weightSum;
    const fit = (axis: "x" | "y") => {
      const meanValue = weighted.reduce((sum, sample) => sum + sample.coordinate[axis] * sample.weight, 0) / weightSum;
      const denominator = weighted.reduce((sum, sample) => sum + sample.weight * (sample.t - meanTime) ** 2, 0);
      if (denominator === 0) return meanValue;
      const slope = weighted.reduce((sum, sample) =>
        sum + sample.weight * (sample.t - meanTime) * (sample.coordinate[axis] - meanValue), 0) / denominator;
      return meanValue + slope * (0 - meanTime);
    };
    const x = fit("x");
    const y = fit("y");
    return {
      ...point,
      latitude: origin.latitude + y / 111_320,
      longitude: origin.longitude + x / metersPerLongitudeDegree,
    };
  });
}

function polylineDistance(points: readonly RecordedFlightPoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += segmentDistance(points[index - 1], points[index]);
  }
  return distance;
}

function microOscillationCount(
  raw: readonly RecordedFlightPoint[],
  filtered: readonly RecordedFlightPoint[],
): number {
  let count = 0;
  for (let index = 1; index < raw.length - 1; index += 1) {
    const rawDetour = distanceMeters(raw[index - 1], raw[index]) + distanceMeters(raw[index], raw[index + 1]) -
      distanceMeters(raw[index - 1], raw[index + 1]);
    const filteredDetour = distanceMeters(filtered[index - 1], filtered[index]) + distanceMeters(filtered[index], filtered[index + 1]) -
      distanceMeters(filtered[index - 1], filtered[index + 1]);
    const uncertainty = Math.max(
      raw[index - 1].horizontalAccuracyMeters ?? 0,
      raw[index].horizontalAccuracyMeters ?? 0,
      raw[index + 1].horizontalAccuracyMeters ?? 0,
    );
    if (rawDetour > 0.25 && rawDetour <= uncertainty * 2 && filteredDetour < rawDetour * 0.5) count += 1;
  }
  return count;
}

export function calculateFilteredHorizontalDistance(
  points: readonly RecordedFlightPoint[],
): FilteredHorizontalDistanceResult {
  let rawDistanceMeters = 0;
  let filteredDistanceMeters = 0;
  let neutralizedMicroOscillations = 0;
  for (const run of reliableRuns(points)) {
    const filtered = filteredRun(run);
    rawDistanceMeters += polylineDistance(run);
    filteredDistanceMeters += polylineDistance(filtered);
    neutralizedMicroOscillations += microOscillationCount(run, filtered);
  }
  const removedNoiseMeters = Math.max(0, rawDistanceMeters - filteredDistanceMeters);
  return {
    rawDistanceMeters,
    filteredDistanceMeters,
    removedNoiseMeters,
    removedPercentage: rawDistanceMeters > 0 ? removedNoiseMeters / rawDistanceMeters * 100 : 0,
    neutralizedMicroOscillations,
  };
}
