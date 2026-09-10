import { currentPreparationValue } from "./preparationSession.ts";
import type { StoredFlightPreparationV2 } from "./flightStorage.ts";
import { loadPreparationDraft } from "./preparationDraftStorage.ts";
import { createTrajectoryAnalysisKey } from "./trajectory/analysisState.ts";
import { normalizeAltitudeOptions, type MultiAltitudeProjectionRequest } from "./trajectory/integration.ts";
import { getTrajectoryAnalysisRequest } from "./trajectory/projectionStorage.ts";
import { WEATHER_MODEL_REGISTRY, weatherModelByProviderId } from "./weather/models.ts";
import {
  isUsableWeatherAnalysisCache, loadWeatherAnalysis, loadExportedPlannedTrajectories,
  type WeatherAnalysisState, type WeatherAnalysisTrace, type ExportedPlannedTrajectory,
  type FlightWeatherSnapshot,
} from "./trajectory/weatherAnalysisStorage.ts";

export type ValidatedFlightWeather = {
  snapshot: FlightWeatherSnapshot | null;
  trajectories: ExportedPlannedTrajectory[];
  validUntil: number | null;
};
const unavailable = (): ValidatedFlightWeather => ({ snapshot: null, trajectories: [], validUntil: null });

/** Uses the existing analysis signature, never a second cache identity. */
export function validateFlightWeather(input: {
  preparation: StoredFlightPreparationV2 | null;
  request: MultiAltitudeProjectionRequest | null;
  analysis: WeatherAnalysisState | null;
  trajectories: ExportedPlannedTrajectory[];
  now: number;
}): ValidatedFlightWeather {
  try {
    const { preparation, analysis, now } = input;
    const request: MultiAltitudeProjectionRequest | null = preparation
      ? preparation.launchSite && preparation.departureTime && preparation.durationMinutes
        ? {
            version: 2, launchSite: preparation.launchSite,
            launchDateTimeIso: preparation.departureTime,
            durationSeconds: preparation.durationMinutes * 60,
            weatherModel: preparation.weatherModel,
            altitudesAmslM: preparation.selectedAltitudes ?? input.request?.altitudesAmslM ?? [],
            climbRateMps: preparation.ascentRateMps,
            descentRateMps: preparation.descentRateMps,
          }
        : null
      : input.request;
    if (!request || !analysis || !Number.isFinite(now)) return unavailable();
    const model = weatherModelByProviderId(request.weatherModel);
    const requestedAltitudes = normalizeAltitudeOptions(request.altitudesAmslM);
    const selectedAltitudes = normalizeAltitudeOptions(analysis.selectedAltitudes);
    if (!model?.supported || !requestedAltitudes.length || !selectedAltitudes.length || !analysis.selectedModelIds.length ||
        analysis.selectedModelIds.some((id) => !WEATHER_MODEL_REGISTRY.some((candidate) => candidate.id === id && candidate.supported))) return unavailable();
    if (preparation && input.request) {
      // A new draft invalidates an older submitted request. Once submitted,
      // model/altitude selections made on the analysis map remain authoritative,
      // exactly as in its existing offline restoration path.
      const draftKey = createTrajectoryAnalysisKey(request, [request.weatherModel], requestedAltitudes);
      const submittedKey = createTrajectoryAnalysisKey(input.request, [input.request.weatherModel], input.request.altitudesAmslM);
      if (draftKey !== submittedKey) return unavailable();
    } else if (!input.request && (
      !analysis.selectedModelIds.includes(model.id) ||
      JSON.stringify(selectedAltitudes) !== JSON.stringify(requestedAltitudes)
    )) return unavailable();
    const expectedKey = createTrajectoryAnalysisKey(request, analysis.selectedModelIds, selectedAltitudes);
    if (!isUsableWeatherAnalysisCache(analysis, expectedKey)) return unavailable();

    const startsAt = Date.parse(request.launchDateTimeIso);
    const validUntil = startsAt + request.durationSeconds * 1_000;
    // A forecast is usable during preparation, before the planned departure.
    // That timestamp identifies the forecast, not an activation time. Keep the
    // existing planned-end cutoff; no provider TTL or online refresh is added.
    if (!Number.isFinite(startsAt) || !Number.isFinite(validUntil) || request.durationSeconds <= 0 ||
        now >= validUntil || Date.parse(analysis.updatedAtIso) > now) return unavailable();

    const traces = analysis.traces.filter((trace) =>
      analysis.selectedModelIds.includes(trace.model.id) &&
      WEATHER_MODEL_REGISTRY.some((candidate) => candidate.id === trace.model.id && candidate.providerModelId === trace.model.providerModelId) &&
      Date.parse(trace.forecastAtIso) === startsAt &&
      Number.isFinite(Date.parse(trace.calculatedAtIso)) && Date.parse(trace.calculatedAtIso) <= now,
    );
    // The full wind profile is already persisted in the signed analysis.
    // Select its reference model independently of exported/visible map layers.
    const profileSources = traces.filter((trace) =>
      Number.isFinite(trace.terrainAltitudeAmslM) &&
      (preparation?.launchSite?.terrainAltitudeAmslM === undefined || preparation.launchSite.terrainAltitudeAmslM === trace.terrainAltitudeAmslM) &&
      trace.predictedWindProfile?.length && trace.predictedWindProfile.every((wind) =>
        [wind.levelM, wind.altitudeAmslM, wind.directionFromDeg, wind.speedMps].every(Number.isFinite) && wind.speedMps >= 0,
      ),
    );
    const referenceModelId = analysis.selectedModelIds.findLast((id) => profileSources.some((trace) => trace.model.id === id));
    const reference = profileSources.find((trace) => trace.model.id === referenceModelId);
    const snapshot: FlightWeatherSnapshot | null = reference ? {
      version: 1,
      weatherModel: reference.model.providerModelId,
      modelLabel: reference.model.label,
      referenceLocation: {
        name: request.launchSite.name,
        latitude: request.launchSite.latitude,
        longitude: request.launchSite.longitude,
        terrainAltitudeAmslM: reference.terrainAltitudeAmslM,
      },
      forecastAtIso: reference.forecastAtIso,
      sourceUpdatedAt: reference.calculatedAtIso,
      windProfile: reference.predictedWindProfile!,
    } : null;
    return { snapshot, trajectories: validateExportedTrajectories(input.trajectories, traces), validUntil };
  } catch {
    // Missing/legacy/corrupt data must never revive an unverified export.
    return unavailable();
  }
}

/** Optional map exports cannot invalidate an independently validated profile. */
function validateExportedTrajectories(
  exports: ExportedPlannedTrajectory[],
  traces: WeatherAnalysisTrace[],
): ExportedPlannedTrajectory[] {
  if (!Array.isArray(exports)) return [];
  return exports.filter((exported) => {
    try {
      return traces.some((trace) =>
        trace.traceId === exported.traceId && trace.model.id === exported.modelId &&
        trace.model.providerModelId === exported.providerModelId && trace.altitudeKey === exported.altitudeKey &&
        trace.altitudeAmslM === exported.altitudeAmslM && trace.calculatedAtIso === exported.calculatedAtIso &&
        trace.forecastAtIso === exported.forecastAtIso &&
        JSON.stringify(exported.geometry) === JSON.stringify(trace.projection.points.map((point) => [point.longitude, point.latitude])),
      );
    } catch { return false; }
  });
}

export function loadValidatedFlightWeather(now = Date.now()): ValidatedFlightWeather {
  let trajectories: ExportedPlannedTrajectory[] = [];
  try { trajectories = currentPreparationValue("exports", loadExportedPlannedTrajectories()) ?? []; } catch { /* Optional layer unavailable. */ }
  try {
    return validateFlightWeather({
      preparation: loadPreparationDraft(), request: getTrajectoryAnalysisRequest()?.request ?? null,
      analysis: currentPreparationValue("analysis", loadWeatherAnalysis()), trajectories, now,
    });
  } catch { return unavailable(); }
}

/** A recovered/active flight never borrows a different preparation's forecast. */
export function selectFlightWeatherSnapshot(
  validated: FlightWeatherSnapshot | null,
  flight: { weatherSnapshot?: FlightWeatherSnapshot } | null,
): FlightWeatherSnapshot | null {
  if (!flight) return validated;
  return validated && JSON.stringify(flight.weatherSnapshot) === JSON.stringify(validated)
    ? flight.weatherSnapshot! : null;
}
