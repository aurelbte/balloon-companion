import type { StoredFlightPreparationV2 } from "./flightStorage.ts";
import { loadPreparationDraft } from "./preparationDraftStorage.ts";
import { createTrajectoryAnalysisKey } from "./trajectory/analysisState.ts";
import { normalizeAltitudeOptions, type MultiAltitudeProjectionRequest } from "./trajectory/integration.ts";
import { getTrajectoryAnalysisRequest } from "./trajectory/projectionStorage.ts";
import { WEATHER_MODEL_REGISTRY, weatherModelByProviderId } from "./weather/models.ts";
import {
  isUsableWeatherAnalysisCache, loadWeatherAnalysis, loadExportedPlannedTrajectories,
  loadFlightWeatherSnapshot, type WeatherAnalysisState, type ExportedPlannedTrajectory,
  type FlightWeatherSnapshot,
} from "./trajectory/weatherAnalysisStorage.ts";

export type ValidatedFlightWeather = {
  snapshot: FlightWeatherSnapshot | null;
  trajectories: ExportedPlannedTrajectory[];
  validUntil: number | null;
};
const unavailable = (): ValidatedFlightWeather => ({ snapshot: null, trajectories: [], validUntil: null });
const coordinate = (value: number) => Number(value.toFixed(6));

/** Uses the existing analysis signature, never a second cache identity. */
export function validateFlightWeather(input: {
  preparation: StoredFlightPreparationV2 | null;
  request: MultiAltitudeProjectionRequest | null;
  analysis: WeatherAnalysisState | null;
  snapshot: FlightWeatherSnapshot | null;
  trajectories: ExportedPlannedTrajectory[];
  now: number;
}): ValidatedFlightWeather {
  try {
    const { preparation, analysis, snapshot, now } = input;
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
    const trajectories = input.trajectories.filter((exported) => traces.some((trace) =>
      trace.traceId === exported.traceId && trace.model.id === exported.modelId &&
      trace.model.providerModelId === exported.providerModelId && trace.altitudeKey === exported.altitudeKey &&
      trace.altitudeAmslM === exported.altitudeAmslM && trace.calculatedAtIso === exported.calculatedAtIso &&
      trace.forecastAtIso === exported.forecastAtIso &&
      JSON.stringify(exported.geometry) === JSON.stringify(trace.projection.points.map((point) => [point.longitude, point.latitude])),
    ));
    const reference = snapshot && traces.find((trace) =>
      trace.model.providerModelId === snapshot.weatherModel &&
      trace.calculatedAtIso === snapshot.sourceUpdatedAt && trace.forecastAtIso === snapshot.forecastAtIso &&
      trace.terrainAltitudeAmslM === snapshot.referenceLocation.terrainAltitudeAmslM &&
      JSON.stringify(trace.predictedWindProfile) === JSON.stringify(snapshot.windProfile),
    );
    const snapshotValid = snapshot && reference &&
      coordinate(snapshot.referenceLocation.latitude) === coordinate(request.launchSite.latitude) &&
      coordinate(snapshot.referenceLocation.longitude) === coordinate(request.launchSite.longitude) &&
      (preparation?.launchSite?.terrainAltitudeAmslM === undefined || preparation.launchSite.terrainAltitudeAmslM === snapshot.referenceLocation.terrainAltitudeAmslM) &&
      snapshot.windProfile.length > 0 && snapshot.windProfile.every((wind) =>
        [wind.levelM, wind.altitudeAmslM, wind.directionFromDeg, wind.speedMps].every(Number.isFinite) && wind.speedMps >= 0,
      );
    return { snapshot: snapshotValid ? snapshot : null, trajectories, validUntil };
  } catch {
    // Missing/legacy/corrupt data must never revive an unverified export.
    return unavailable();
  }
}

export function loadValidatedFlightWeather(now = Date.now()): ValidatedFlightWeather {
  try {
    return validateFlightWeather({
      preparation: loadPreparationDraft(), request: getTrajectoryAnalysisRequest()?.request ?? null,
      analysis: loadWeatherAnalysis(), snapshot: loadFlightWeatherSnapshot(),
      trajectories: loadExportedPlannedTrajectories(), now,
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
