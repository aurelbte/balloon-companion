import type { MultiAltitudeProjectionSuccess, MultiAltitudeProjectionRequest } from "./trajectory/integration.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";
import { prepareFlightDossierWeather } from "./flightDossierWeather.ts";
import { parseOpenMeteoWindColumn } from "./weather/openMeteo/parser.ts";
import { createMoroccoWeatherArchive, currentMoroccoWeatherArchiveStore, type MoroccoWeatherArchiveStore } from "./moroccoWeatherArchive.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Full validated calculation request, effective terrain and selected projection, not a display trace ID. */
export function moroccoCalculationIdentity(request: MultiAltitudeProjectionRequest, trace: WeatherAnalysisTrace, terrainAltitudeAmslM: number): string {
  return canonical({ version: 2, request: { ...request, launchDateTimeIso: new Date(request.launchDateTimeIso).toISOString() }, terrainAltitudeAmslM,
    selectedProjection: { altitudeKey: trace.altitudeKey, altitudeAmslM: trace.altitudeAmslM } });
}

/** No fetch: archive the exact payload handed to the wind provider during calculation. */
export async function archiveMoroccoCalculation(payload: MultiAltitudeProjectionSuccess, trace: WeatherAnalysisTrace, receivedAt: string, store: MoroccoWeatherArchiveStore = currentMoroccoWeatherArchiveStore()): Promise<void> {
  const evidence = payload.moroccoCalculation;
  if (!evidence || !evidence.rawForecasts.length) throw new Error("Données météo brutes du calcul absentes : archive Maroc non attestée.");
  const identity = moroccoCalculationIdentity(evidence.request, trace, payload.terrainAltitudeAmslM);
  if (trace.moroccoPreparationIdentity !== identity) throw new Error("Identité de préparation Maroc incohérente.");
  const first = trace.projection.points[0], last = trace.projection.points.at(-1)!;
  const dossier = { traceId: trace.traceId, moroccoPreparationIdentity: identity, strategyLabel: trace.label,
    launchSiteName: evidence.request.launchSite.name, launchTimeZone: evidence.request.launchTimeZone,
    startedAt: trace.projection.startedAt, landingAt: last.timestamp, durationSeconds: trace.projection.durationSeconds, model: trace.model, points: trace.projection.points };
  const weather = await prepareFlightDossierWeather({ traceId: trace.traceId, weatherModel: trace.model.providerModelId, departure: first, landing: last }, {
    now: () => Date.parse(receivedAt), stations: async () => [],
    aviation: async () => ({ data: null, error: { code: "NO_DATA", message: "Non disponible : METAR/TAF non acquis pendant ce calcul." } }),
    altitude: async () => {
      const raw = evidence.rawForecasts.find(raw => raw.kind === "calculation" && raw.model === trace.model.providerModelId && raw.query.latitude === evidence.request.launchSite.latitude && raw.query.longitude === evidence.request.launchSite.longitude);
      if (!raw) throw new Error("Non disponible : colonne brute du calcul absente.");
      return { column: parseOpenMeteoWindColumn(raw.payload, raw.model, payload.terrainAltitudeAmslM, 0), fetchedAt: raw.receivedAt };
    },
    ground: async () => { throw new Error("Non disponible : aucune prévision au sol au point d’atterrissage acquise pendant ce calcul. Le vent du départ n’est pas substitué."); },
  });
  weather.notices = ["Archive partielle des réponses réellement utilisées par le calcul. Aucun rechargement météo supplémentaire.",
    "METAR/TAF et vent au sol à l’atterrissage non acquis pendant ce calcul : Non disponible. Fenêtre limitée aux échéances effectivement reçues.",
    "Run non communiqué par le fournisseur. L’horodatage de réception n’est pas une date de run.",
    ...(payload.failures ?? []).map(failure => `Calcul partiel - ${failure.altitudeKey} : ${failure.code} - ${failure.message}`)];
  const archive = await createMoroccoWeatherArchive(dossier, trace, { weather, rawForecasts: evidence.rawForecasts, calculationRequest: evidence.request, calculationFailures: payload.failures ?? [] }, receivedAt);
  await store.saveOnce(archive);
}
