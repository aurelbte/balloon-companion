import type { AltitudeOption, MultiAltitudeProjectionRequest } from "./integration.ts";

export const MAX_ANALYSIS_MODELS = 3;
export const MAX_ANALYSIS_ALTITUDES = 5;

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
    models: [...models].sort(),
    altitudes: [...altitudes].map(String).sort(),
  });
}

export function toggleLimitedSelection<T>({
  current,
  value,
  maximum,
  minimum = 1,
}: {
  current: readonly T[];
  value: T;
  maximum: number;
  minimum?: number;
}): { values: T[]; limitReached: boolean } {
  if (current.includes(value)) {
    return current.length <= minimum
      ? { values: [...current], limitReached: false }
      : { values: current.filter((item) => item !== value), limitReached: false };
  }
  return current.length >= maximum
    ? { values: [...current], limitReached: true }
    : { values: [...current, value], limitReached: false };
}
