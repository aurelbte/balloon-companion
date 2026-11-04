import type { FlightDossierOperations } from "./flightDossierOperations.ts";
import type { Balloon } from "./balloons.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";

export type FlightDossierResult =
  | { status: "INVALID"; message: string }
  | { status: "READY"; data: {
      traceId: string;
      strategyLabel?: string;
      launchSiteName?: string;
      launchTimeZone?: string;
      points: WeatherAnalysisTrace["projection"]["points"];
      model: WeatherAnalysisTrace["model"];
      startedAt: string;
      landingAt: string;
      durationSeconds: number;
      balloon: Balloon;
      operations?: FlightDossierOperations;
    } };

/** Resolve only the explicitly selected strategy; never substitute another trace. */
export function prepareFlightDossier(
  traceId: string,
  traces: readonly WeatherAnalysisTrace[],
  balloon: Balloon | undefined,
): FlightDossierResult {
  const trace = traces.find((candidate) => candidate.traceId === traceId);
  const invalid = (): FlightDossierResult => ({ status: "INVALID", message: "Dossier indisponible : la trajectoire sélectionnée est absente ou invalide. Sélectionnez une stratégie valide." });
  if (!traceId || !trace || traces.filter((candidate) => candidate.traceId === traceId).length !== 1) return invalid();
  if (!isValidFlightDossierTrace(trace)) return invalid();
  const { points, startedAt, durationSeconds } = trace.projection;
  if (!balloon) return { status: "INVALID", message: "Dossier indisponible : sélectionnez un ballon dans Prépa." };
  return { status: "READY", data: { traceId, strategyLabel: trace.label, points, model: trace.model, startedAt, landingAt: points.at(-1)!.timestamp, durationSeconds, balloon } };
}

/** Strategy validity is independent of balloon readiness; export checks both. */
export function isValidFlightDossierTrace(trace: WeatherAnalysisTrace | undefined): trace is WeatherAnalysisTrace {
  if (!trace?.traceId) return false;
  if (!trace.projection || !Array.isArray(trace.projection.points)) return false;
  const { points, startedAt, durationSeconds } = trace.projection;
  const start = Date.parse(startedAt);
  if (points.length < 2 || !Number.isFinite(start) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !trace.model?.providerModelId || !trace.model.label) return false;
  let previous = -Infinity;
  for (const point of points) {
    if (!point) return false;
    const timestamp = Date.parse(point.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= previous || timestamp < start ||
      !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
      !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
      !Number.isFinite(point.altitudeAmslM)) return false;
    previous = timestamp;
  }
  if (Date.parse(points[0].timestamp) !== start || Math.abs(previous - start - durationSeconds * 1000) > 1000) return false;
  return true;
}

export function selectFlightDossierTrace(traces: readonly WeatherAnalysisTrace[], mapTraceId: string | null, selectedIds: readonly string[]): WeatherAnalysisTrace | undefined {
  const id = mapTraceId ?? (selectedIds.length === 1 ? selectedIds[0] : traces.length === 1 ? traces[0].traceId : null);
  if (traces.filter((item) => item.traceId === id).length !== 1) return undefined;
  const trace = traces.find((item) => item.traceId === id);
  return isValidFlightDossierTrace(trace) ? trace : undefined;
}
