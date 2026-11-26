import type { MultiAltitudeProjectionSuccess, MultiAltitudeProjectionRequest } from "./trajectory/integration.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";
import { prepareFlightDossierWeather } from "./flightDossierWeather.ts";
import { parseOpenMeteoWindColumn } from "./weather/openMeteo/parser.ts";
import { parseHourlyForecast } from "./weather/openMeteo/hourlyForecast.ts";
import { createMoroccoWeatherArchive, currentMoroccoWeatherArchiveStore, type MoroccoWeatherArchiveStore, type SavedMoroccoWeatherArchive } from "./moroccoWeatherArchive.ts";
import { getRuntimeDataScope, getRuntimeDataScopeGeneration } from "./auth/dataScopeRuntime.ts";

const memoryArchives = new Map<string, SavedMoroccoWeatherArchive>();
export function currentCalculationArchive(identity: string | undefined) { return memoryArchives.get(pendingKey(identity)); }

const pendingWrites = new Map<string, Promise<void>>();
const pendingKey = (identity: string | undefined) => JSON.stringify([getRuntimeDataScope(), getRuntimeDataScopeGeneration(), identity]);

/** Immediate export waits for the preparation's existing write, never for a new forecast. */
export async function waitForMoroccoCalculationArchive(identity: string | undefined): Promise<void> {
  if (identity) await pendingWrites.get(pendingKey(identity));
}

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
export function archiveMoroccoCalculation(payload: MultiAltitudeProjectionSuccess, trace: WeatherAnalysisTrace, receivedAt: string, store?: MoroccoWeatherArchiveStore): Promise<void> {
  const key = pendingKey(trace.moroccoPreparationIdentity);
  const write = saveMoroccoCalculation(payload, trace, receivedAt, key, store);
  pendingWrites.set(key, write);
  const clear = () => { if (pendingWrites.get(key) === write) pendingWrites.delete(key); };
  void write.then(clear, clear);
  return write;
}

async function saveMoroccoCalculation(payload: MultiAltitudeProjectionSuccess, trace: WeatherAnalysisTrace, receivedAt: string, scopeKey: string, store?: MoroccoWeatherArchiveStore): Promise<void> {
  const scopedStore = store ?? currentMoroccoWeatherArchiveStore();
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
    ground: async () => {
      const raw = evidence.rawForecasts.find(raw => raw.kind === "ground" && raw.model === trace.model.providerModelId &&
        raw.query.latitude === last.latitude && raw.query.longitude === last.longitude && raw.query.landingAt === last.timestamp);
      if (!raw) throw new Error("Non disponible : aucune prévision au sol au point d’atterrissage acquise pendant ce calcul. Le vent du départ n’est pas substitué.");
      const body = raw.payload as { utc_offset_seconds?: unknown; hourly_units?: Record<string, unknown> } | null;
      if (body?.utc_offset_seconds !== 0 || body.hourly_units?.wind_speed_10m !== "km/h" || body.hourly_units.wind_direction_10m !== "°" ||
        (body.hourly_units.wind_gusts_10m !== undefined && body.hourly_units.wind_gusts_10m !== "km/h"))
        throw new Error("Non disponible : unités ou référence UTC de la prévision d’arrivée non vérifiables.");
      return parseHourlyForecast(raw.payload, raw.model, raw.receivedAt);
    },
  });
  const aviation = evidence.aviation?.find(item => item.departure.latitude === first.latitude && item.departure.longitude === first.longitude && item.departure.timestamp === first.timestamp &&
    item.landing.latitude === last.latitude && item.landing.longitude === last.longitude && item.landing.timestamp === last.timestamp);
  const timeNotices: string[] = [];
  if (aviation) {
    weather.aviation = structuredClone(aviation.data);
    for (const location of ["departure", "landing"] as const) for (const product of ["metar", "taf"] as const) {
      const item = weather.aviation[location][product], data = item.result.data;
      const stamps = data ? [data.sourceUpdatedAt, ...(data.metarRaw ? [data.metarIssuedAt] : []), ...(data.tafRaw ? [data.tafIssuedAt] : [])] : [];
      if (stamps.some(stamp => typeof stamp !== "string" || !/Z$/.test(stamp) || !Number.isFinite(Date.parse(stamp)) || Date.parse(stamp) > Date.parse(receivedAt)) ||
        !!data && stamps.slice(1).some(stamp => !!stamp && Date.parse(stamp) > Date.parse(data.sourceUpdatedAt))) {
        timeNotices.push(`${location} ${product.toUpperCase()} : horodatages absents ou incohérents avec la réception du calcul ; bulletin non utilisé. Réponse originale conservée.`);
        weather.aviation[location][product] = { ...item, freshness: null, status: "UNAVAILABLE", result: { data: null, error: { code: "NO_DATA", message: "Horodatages du bulletin non vérifiables." } } };
      }
    }
  }
  weather.notices = ["Archive des réponses réellement utilisées par le calcul et, si acquise, de la prévision à 10 m au point d’arrivée calculé. Aucun rechargement météo à l’export.",
    aviation ? "METAR/TAF acquis avec la préparation : émissions et réceptions originales conservées ; les produits manquants restent indisponibles." : "Archive partielle : METAR/TAF non acquis pendant ce calcul. Données manquantes : Non disponible.",
    "Fenêtre limitée aux échéances effectivement reçues ; données manquantes : Non disponible.",
    "Run non communiqué par le fournisseur. L’horodatage de réception n’est pas une date de run.",
    ...timeNotices,
    ...(evidence.notices ?? []),
    ...(payload.failures ?? []).map(failure => `Calcul partiel - ${failure.altitudeKey} : ${failure.code} - ${failure.message}`)];
  const archive = await createMoroccoWeatherArchive(dossier, trace, { weather, rawForecasts: evidence.rawForecasts, calculationRequest: evidence.request, calculationAviation: evidence.aviation, calculationFailures: payload.failures ?? [] }, receivedAt);
  if (pendingKey(identity) !== scopeKey) throw new Error("Compte local modifié pendant la sauvegarde météo de la préparation.");
  // Retain usable evidence even if IndexedDB is unavailable or its commit fails.
  memoryArchives.set(scopeKey, { ...archive, storedAt: new Date().toISOString() });
  if (memoryArchives.size > 64) memoryArchives.delete(memoryArchives.keys().next().value!);
  await scopedStore.saveOnce(archive);
}
