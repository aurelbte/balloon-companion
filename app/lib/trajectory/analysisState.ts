import type { AltitudeOption, MultiAltitudeProjectionRequest } from "./integration.ts";

export function createTrajectoryAnalysisKey(
  request: MultiAltitudeProjectionRequest,
  models: readonly string[],
  altitudes: readonly AltitudeOption[],
): string {
  return JSON.stringify({
    latitude: Number(request.launchSite.latitude.toFixed(6)),
    longitude: Number(request.launchSite.longitude.toFixed(6)),
    dateTime: request.launchDateTimeIso,
    durationSeconds: request.durationSeconds,
    ascentRateMps: request.climbRateMps ?? 0,
    descentRateMps: request.descentRateMps === undefined
      ? 0
      : -Math.abs(request.descentRateMps),
    models: [...models].sort(),
    altitudes: [...altitudes].map(String).sort(),
  });
}

export function toggleSelection<T>({
  current,
  value,
  minimum = 1,
}: {
  current: readonly T[];
  value: T;
  minimum?: number;
}): T[] {
  if (current.includes(value)) {
    return current.length <= minimum
      ? [...current]
      : current.filter((item) => item !== value);
  }
  return [...current, value];
}
