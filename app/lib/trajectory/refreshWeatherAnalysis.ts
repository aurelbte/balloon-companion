import { getRuntimeDataScope, getRuntimeDataScopeGeneration } from "../auth/dataScopeRuntime.ts";
import { currentPreparationValue } from "../preparationSession.ts";
import { getTrajectoryAnalysisRequest } from "./projectionStorage.ts";
import { loadWeatherAnalysis, saveWeatherAnalysis, type WeatherAnalysisTrace } from "./weatherAnalysisStorage.ts";
import { WEATHER_MODEL_REGISTRY } from "../weather/models.ts";
import type { MultiAltitudeProjectionApiResponse } from "./integration.ts";

/** Recompute the current preparation before a new launch, never an active flight. */
export async function refreshCurrentWeatherAnalysis(): Promise<boolean> {
  const scope = getRuntimeDataScope(), generation = getRuntimeDataScopeGeneration();
  const request = getTrajectoryAnalysisRequest()?.request;
  const analysis = currentPreparationValue("analysis", loadWeatherAnalysis());
  if (!scope || !request || !analysis || !analysis.selectedModelIds.length || !navigator.onLine) return false;
  const original = JSON.stringify(analysis), originalRequest = JSON.stringify(request);
  const current = () => getRuntimeDataScope() === scope && getRuntimeDataScopeGeneration() === generation &&
    JSON.stringify(currentPreparationValue("analysis", loadWeatherAnalysis())) === original &&
    JSON.stringify(getTrajectoryAnalysisRequest()?.request) === originalRequest;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const calculatedAtIso = new Date().toISOString();
  const traces: WeatherAnalysisTrace[] = [];
  try {
  for (const modelId of analysis.selectedModelIds) {
    if (!current() || controller.signal.aborted) return false;
    const model = WEATHER_MODEL_REGISTRY.find(candidate => candidate.id === modelId);
    if (!model?.supported) return false;
    try {
      const response = await fetch("/api/trajectory/project", {
        signal: controller.signal,
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, weatherModel: model.providerModelId, altitudesAmslM: analysis.selectedAltitudes }),
      });
      const payload = await response.json() as MultiAltitudeProjectionApiResponse;
      if (!response.ok || !payload.ok || !current() || !payload.layerProjections.length || payload.failures.length) return false;
      traces.push(...payload.layerProjections.map(trace => ({
        ...trace,
        ...(payload.flightProfileProjection && trace.altitudeAmslM === request.primaryAltitudeAmslM ? { projection: payload.flightProfileProjection } : {}),
        traceId: `${model.id}:${trace.altitudeKey}`, model, calculatedAtIso,
        forecastAtIso: request.launchDateTimeIso, weatherFetchedAt: payload.weatherFetchedAt, modelRunAt: null,
        terrainAltitudeAmslM: payload.terrainAltitudeAmslM, predictedWindProfile: payload.windProfile,
      })));
    } catch { return false; }
  }
  return !controller.signal.aborted && current() && saveWeatherAnalysis({ ...analysis, updatedAtIso: calculatedAtIso, traces, failures: [] });
  } finally { clearTimeout(timeout); }
}
