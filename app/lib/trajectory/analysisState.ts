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
    launchTimeZone: request.launchTimeZone ?? null,
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

/** Calculation context only; model/altitude choices belong to individual projections. */
export function createTrajectoryPreparationKey(request: MultiAltitudeProjectionRequest): string {
  const { weatherModel: _model, altitudesAmslM: _altitudes, ...preparation } = request;
  return JSON.stringify(preparation);
}

type SelectedTrace = { traceId: string; model: { id: string }; altitudeKey: string };
export function selectedProjectionTraces<T extends SelectedTrace>(traces: readonly T[], models: readonly string[], altitudes: readonly AltitudeOption[]): T[] {
  const keys = new Set(altitudes.map(String));
  return traces.filter(trace => models.includes(trace.model.id) && keys.has(trace.altitudeKey));
}

/** Replace successes, retaining only still-selected failures from the same preparation. */
export function mergeProjectionResults<T extends SelectedTrace>(previous: readonly T[], incoming: readonly T[],
  failures: readonly { modelId: string; altitudeKey: string }[], models: readonly string[], altitudes: readonly AltitudeOption[]): T[] {
  const next = selectedProjectionTraces(incoming, models, altitudes);
  const ids = new Set(next.map(trace => trace.traceId));
  return [...next, ...selectedProjectionTraces(previous, models, altitudes).filter(trace => !ids.has(trace.traceId)
    && failures.some(failure => failure.modelId === trace.model.id && (failure.altitudeKey === "all" || failure.altitudeKey === trace.altitudeKey)))];
}
