import { aviationFreshness, type AviationFreshness } from "./aviation/aviationFreshness.ts";
import type { AviationStationLocation } from "./aviation/airportSearch.ts";
import type { AviationWeatherResult } from "./aviation/types.ts";
import type { OpenMeteoWindColumn, WeatherHourlyForecast } from "./weather/openMeteo/types.ts";
import { weatherModelByProviderId } from "./weather/models.ts";

const HOUR_MS = 3_600_000;
export type DossierLocation = { latitude: number; longitude: number; timestamp: string };
export type FlightDossierWeatherRequest = {
  traceId: string;
  weatherModel: string;
  departure: DossierLocation;
  landing: DossierLocation;
};
export type DossierStation = AviationStationLocation & { distanceKm: number };
type AviationProduct = { freshness: AviationFreshness | null; station: DossierStation | null; result: AviationWeatherResult; status: "AVAILABLE" | "PARTIAL" | "STALE" | "UNAVAILABLE" };
type AviationLocation = { metar: AviationProduct; taf: AviationProduct };
export type DossierWindSeries<T> = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  requestedLocation: { latitude: number; longitude: number };
  sourceLocation: { latitude: number; longitude: number } | null;
  fetchedAt: string | null;
  modelRunAt: null;
  points: T[];
  missingHours: string[];
  error: string | null;
};
export type DossierAltitudeWind = OpenMeteoWindColumn["slices"][number] & { gusts: null };
export type DossierGroundWind = { validAt: string; heightAglM: 10; directionFromDeg: number | null; speedKmh: number | null; gustKmh: number | null; unavailableFields: string[] };
export type FlightDossierWeather = {
  traceId: string;
  preparedAt: string;
  weatherModel: string;
  window: { startAt: string; endAt: string; expectedHours: string[]; cadence: "HOURLY_UTC" };
  aviation: { source: "aviationweather.gov"; departure: AviationLocation; landing: AviationLocation };
  altitudeWind: DossierWindSeries<DossierAltitudeWind>;
  landingGroundWind: DossierWindSeries<DossierGroundWind>;
  notices: string[];
};
export interface DossierWeatherServices {
  now?: () => number;
  stations(): Promise<AviationStationLocation[]>;
  aviation(icao: string): Promise<AviationWeatherResult>;
  altitude(query: { latitude: number; longitude: number; validAt: string; endValidAt: string; weatherModel: string }): Promise<{ column: OpenMeteoWindColumn; fetchedAt: string }>;
  ground(query: { latitude: number; longitude: number; startAt: string; endAt: string; weatherModel: string }): Promise<WeatherHourlyForecast>;
}

export function isFlightDossierWeatherRequest(value: unknown): value is FlightDossierWeatherRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as FlightDossierWeatherRequest;
  const validLocation = (location: DossierLocation) => location && typeof location.latitude === "number" && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && typeof location.longitude === "number" && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 && typeof location.timestamp === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(location.timestamp) && Number.isFinite(Date.parse(location.timestamp));
  return typeof input.traceId === "string" && input.traceId.trim().length > 0 && input.traceId.length <= 200 && typeof input.weatherModel === "string" && weatherModelByProviderId(input.weatherModel)?.supported === true && !!validLocation(input.departure) && !!validLocation(input.landing) && Date.parse(input.landing.timestamp) > Date.parse(input.departure.timestamp) && Date.parse(input.landing.timestamp) - Date.parse(input.departure.timestamp) <= 24 * HOUR_MS;
}

export function nearestDossierStation(stations: readonly AviationStationLocation[], location: DossierLocation, product: "METAR" | "TAF"): DossierStation | null {
  const rad = (value: number) => value * Math.PI / 180;
  const candidates = stations.filter((station) => station.products.includes(product)).map((station) => {
    const a = Math.sin(rad(station.latitude - location.latitude) / 2) ** 2 + Math.cos(rad(location.latitude)) * Math.cos(rad(station.latitude)) * Math.sin(rad(station.longitude - location.longitude) / 2) ** 2;
    return { ...station, distanceKm: 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) };
  });
  return candidates.sort((a, b) => a.distanceKm - b.distanceKm || a.icao.localeCompare(b.icao))[0] ?? null;
}

/** Acquisition only: no interpolation, no closest-hour approximation, no model fallback. */
export async function prepareFlightDossierWeather(input: FlightDossierWeatherRequest, services: DossierWeatherServices): Promise<FlightDossierWeather> {
  if (!isFlightDossierWeatherRequest(input)) throw new Error("Stratégie météo absente ou invalide.");
  const preparedAt = new Date((services.now ?? Date.now)()).toISOString();
  const start = Date.parse(input.departure.timestamp) - 2 * HOUR_MS;
  const end = Date.parse(input.landing.timestamp) + 2 * HOUR_MS;
  const startAt = new Date(start).toISOString();
  const endAt = new Date(end).toISOString();
  const expectedHours: string[] = [];
  for (let hour = Math.ceil(start / HOUR_MS) * HOUR_MS; hour <= end; hour += HOUR_MS) expectedHours.push(new Date(hour).toISOString());
  const within = (iso: string) => Number.isFinite(Date.parse(iso)) && Date.parse(iso) >= start && Date.parse(iso) <= end;
  const utc = (iso: string) => new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`).toISOString();
  const aviationCache = new Map<string, Promise<AviationWeatherResult>>();
  const unavailable = (message: string): AviationWeatherResult => ({ data: null, error: { code: "SOURCE_UNAVAILABLE", message } });
  const aviation = async (stations: AviationStationLocation[], location: DossierLocation, product: "METAR" | "TAF"): Promise<AviationProduct> => {
    const station = nearestDossierStation(stations, location, product);
    if (!station) return { freshness: null, station: null, result: unavailable(`Station ${product} avec coordonnées indisponible.`), status: "UNAVAILABLE" };
    if (!aviationCache.has(station.icao)) aviationCache.set(station.icao, services.aviation(station.icao).catch(() => unavailable("Source aviation indisponible.")));
    const result = await aviationCache.get(station.icao)!;
    const raw = product === "METAR" ? result.data?.metarRaw : result.data?.tafRaw;
    return { freshness: result.data ? aviationFreshness(result.data, product === "METAR" ? "metar" : "taf", Date.parse(preparedAt)) : null, station, result, status: !raw ? "UNAVAILABLE" : result.data!.status };
  };
  const aviationTask = async () => {
    let stations: AviationStationLocation[] = [];
    try { stations = await services.stations(); } catch { /* Explicit unavailable station results below. */ }
    const [dm, dt, lm, lt] = await Promise.all([aviation(stations, input.departure, "METAR"), aviation(stations, input.departure, "TAF"), aviation(stations, input.landing, "METAR"), aviation(stations, input.landing, "TAF")]);
    return { source: "aviationweather.gov" as const, departure: { metar: dm, taf: dt }, landing: { metar: lm, taf: lt } };
  };
  const series = <T>(location: DossierLocation): DossierWindSeries<T> => ({ status: "UNAVAILABLE", requestedLocation: { latitude: location.latitude, longitude: location.longitude }, sourceLocation: null, fetchedAt: null, modelRunAt: null, points: [], missingHours: [...expectedHours], error: null });
  const altitudeWind = series<DossierAltitudeWind>(input.departure);
  const landingGroundWind = series<DossierGroundWind>(input.landing);
  const altitudeTask = async () => {
    try {
      const { column, fetchedAt } = await services.altitude({ ...input.departure, validAt: startAt, endValidAt: endAt, weatherModel: input.weatherModel });
      if (column.sourceModel !== input.weatherModel) throw new Error("Modèle météo reçu différent du modèle sélectionné.");
      altitudeWind.points = column.slices.filter((point) => within(point.validAt)).map((point) => ({ ...point, levels: point.levels.filter((level) => level.sourceType !== "surface"), gusts: null }));
      altitudeWind.sourceLocation = { latitude: column.sourceLatitude, longitude: column.sourceLongitude };
      altitudeWind.fetchedAt = fetchedAt;
      altitudeWind.missingHours = expectedHours.filter((hour) => !altitudeWind.points.some((point) => Date.parse(point.validAt) === Date.parse(hour) && point.levels.length > 0));
      altitudeWind.status = !altitudeWind.points.some((point) => point.levels.length) ? "UNAVAILABLE" : altitudeWind.missingHours.length || altitudeWind.points.some((point) => point.rejectedLevels.length) ? "PARTIAL" : "AVAILABLE";
    } catch (error) { altitudeWind.error = error instanceof Error ? error.message : "Vent en altitude indisponible."; }
  };
  const groundTask = async () => {
    try {
      const forecast = await services.ground({ ...input.landing, startAt, endAt, weatherModel: input.weatherModel });
      if (forecast.model !== input.weatherModel || forecast.points.some((point) => point.model !== input.weatherModel)) throw new Error("Modèle météo reçu différent du modèle sélectionné.");
      landingGroundWind.points = forecast.points.flatMap((point) => {
        let validAt: string;
        try { validAt = utc(point.timestamp); } catch { return []; }
        if (!within(validAt)) return [];
        const fields = { directionFromDeg: point.windDirectionDeg ?? null, speedKmh: point.windSpeedKmh ?? null, gustKmh: point.windGustKmh ?? null };
        return [{ validAt, heightAglM: 10 as const, ...fields, unavailableFields: Object.entries(fields).filter(([, value]) => value === null).map(([key]) => key) }];
      });
      landingGroundWind.sourceLocation = { latitude: forecast.latitude, longitude: forecast.longitude };
      landingGroundWind.fetchedAt = forecast.sourceUpdatedAt;
      landingGroundWind.missingHours = expectedHours.filter((hour) => !landingGroundWind.points.some((point) => Date.parse(point.validAt) === Date.parse(hour)));
      landingGroundWind.status = !landingGroundWind.points.length || landingGroundWind.points.every((point) => point.unavailableFields.length === 3) ? "UNAVAILABLE" : landingGroundWind.missingHours.length || landingGroundWind.points.some((point) => point.unavailableFields.length) ? "PARTIAL" : "AVAILABLE";
    } catch (error) { landingGroundWind.error = error instanceof Error ? error.message : "Vent au sol indisponible."; }
  };
  const [aviationData] = await Promise.all([aviationTask(), altitudeTask(), groundTask()]);
  return { traceId: input.traceId, preparedAt, weatherModel: input.weatherModel, window: { startAt, endAt, expectedHours, cadence: "HOURLY_UTC" }, aviation: aviationData, altitudeWind, landingGroundWind, notices: ["Profil vertical au départ ; vent au sol à 10 m AGL au point d’atterrissage prévu.", "Échéances horaires originales uniquement ; aucune interpolation. Les bornes entre deux heures ne sont pas extrapolées.", "Rafales en altitude et dates de run non fournies par le service utilisé.", "Stations les plus proches déclarant chaque produit ; leur distance ne garantit pas leur représentativité locale."] };
}
