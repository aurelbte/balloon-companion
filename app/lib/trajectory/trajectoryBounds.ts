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
    ? { top: 88, right: 88, bottom: 118, left: 88 }
    : { top: 72, right: 96, bottom: 110, left: 96 };
}
