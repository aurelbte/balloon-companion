import type { WeatherAnalysisTrace } from "./weatherAnalysisStorage.ts";

export type TrajectoryBounds = { west: number; south: number; east: number; north: number };
export type BoundsLaunchSite = { latitude: number; longitude: number };

function valid(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function longitudeArc(longitudes: number[]): { west: number; east: number } {
  if (longitudes.length === 1) return { west: longitudes[0]!, east: longitudes[0]! };
  const sorted = [...longitudes].sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const next = index === sorted.length - 1 ? sorted[0]! + 360 : sorted[index + 1]!;
    if (next - current > largestGap) { largestGap = next - current; gapIndex = index; }
  }
  const west = sorted[(gapIndex + 1) % sorted.length]!;
  const rawEast = sorted[gapIndex]!;
  return { west, east: rawEast < west ? rawEast + 360 : rawEast };
}

export function calculateTrajectoryBounds(
  visibleTrajectories: readonly WeatherAnalysisTrace[],
  launchSite: BoundsLaunchSite,
): TrajectoryBounds | null {
  const points = [launchSite, ...visibleTrajectories.flatMap((trace) => trace.projection.points)]
    .filter((point) => valid(point.latitude, point.longitude));
  if (points.length === 0) return null;
  const latitudeValues = points.map((point) => point.latitude);
  const longitude = longitudeArc(points.map((point) => point.longitude));
  return { ...longitude, south: Math.min(...latitudeValues), north: Math.max(...latitudeValues) };
}

export function analysisFitPadding(width: number): { top: number; right: number; bottom: number; left: number } {
  return width < 768
    ? { top: 95, right: 105, bottom: 125, left: 105 }
    : { top: 72, right: 96, bottom: 110, left: 96 };
}

export function analysisFitMaxZoom(width: number): number {
  return width < 768 ? 11 : 12;
}

export function trajectoryContentKey(
  trajectories: readonly WeatherAnalysisTrace[],
): string {
  return trajectories.map((trace) => {
    const points = trace.projection.points;
    const first = points[0];
    const last = points.at(-1);
    const coordinate = (point: (typeof points)[number] | undefined) => point
      ? `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`
      : "none";
    return [
      trace.traceId,
      trace.model.id,
      trace.altitudeKey,
      trace.calculatedAtIso,
      points.length,
      coordinate(first),
      coordinate(last),
    ].join(":");
  }).sort().join("|");
}

export function createTrajectoryFitKey({
  analysisKey,
  visibleTraceIds,
  width,
  height,
  recenterToken,
  trajectoryKey,
}: {
  analysisKey: string;
  visibleTraceIds: readonly string[];
  width: number;
  height: number;
  recenterToken: number;
  trajectoryKey: string;
}): string {
  return [
    analysisKey,
    [...visibleTraceIds].sort().join(","),
    `${Math.round(width)}x${Math.round(height)}`,
    recenterToken,
    trajectoryKey,
  ].join("|");
}

export function countValidTrajectoryPoints(
  trajectories: readonly WeatherAnalysisTrace[],
): number {
  return trajectories.reduce(
    (total, trace) => total + trace.projection.points.filter((point) => valid(point.latitude, point.longitude)).length,
    0,
  );
}
