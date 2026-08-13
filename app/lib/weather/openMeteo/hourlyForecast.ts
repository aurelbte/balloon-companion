import type { NormalizedWeatherCode, OpenMeteoClient, OpenMeteoWeatherModel, WeatherHourlyForecast, WeatherHourlyPoint } from "./types.ts";

type RecordValue = Record<string, unknown>;
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { expiresAt: number; value: WeatherHourlyForecast }>();

function record(value: unknown): RecordValue | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null; }
function optionalNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function at(values: unknown, index: number): number | undefined { return Array.isArray(values) ? optionalNumber(values[index]) : undefined; }

export function normalizeWeatherCode(value: number | undefined): NormalizedWeatherCode {
  if (value === undefined) return "UNKNOWN";
  const codes: Record<number, NormalizedWeatherCode> = {
    0: "CLEAR", 1: "MAINLY_CLEAR", 2: "PARTLY_CLOUDY", 3: "OVERCAST",
    45: "FOG", 48: "RIME_FOG",
    51: "LIGHT_DRIZZLE", 53: "MODERATE_DRIZZLE", 55: "DENSE_DRIZZLE",
    56: "LIGHT_FREEZING_DRIZZLE", 57: "DENSE_FREEZING_DRIZZLE",
    61: "LIGHT_RAIN", 63: "MODERATE_RAIN", 65: "HEAVY_RAIN",
    66: "LIGHT_FREEZING_RAIN", 67: "HEAVY_FREEZING_RAIN",
    71: "LIGHT_SNOW", 73: "MODERATE_SNOW", 75: "HEAVY_SNOW", 77: "SNOW_GRAINS",
    80: "LIGHT_RAIN_SHOWERS", 81: "MODERATE_RAIN_SHOWERS", 82: "VIOLENT_RAIN_SHOWERS",
    85: "LIGHT_SNOW_SHOWERS", 86: "HEAVY_SNOW_SHOWERS",
    95: "THUNDERSTORM", 96: "THUNDERSTORM_LIGHT_HAIL", 99: "THUNDERSTORM_HEAVY_HAIL",
  };
  return codes[value] ?? "UNKNOWN";
}

export function parseHourlyForecast(payload: unknown, model: OpenMeteoWeatherModel, fetchedAt = new Date().toISOString()): WeatherHourlyForecast {
  const root = record(payload);
  const hourly = record(root?.hourly);
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const latitude = optionalNumber(root?.latitude);
  const longitude = optionalNumber(root?.longitude);
  const timezone = typeof root?.timezone === "string" && root.timezone.trim() ? root.timezone : undefined;
  if (latitude === undefined || longitude === undefined || !hourly) throw new Error("Réponse météo horaire invalide.");
  const points = times.flatMap<WeatherHourlyPoint>((timestamp, index) => {
    if (typeof timestamp !== "string" || !timestamp.trim()) return [];
    const point: WeatherHourlyPoint = { timestamp, weatherCode: normalizeWeatherCode(at(hourly.weather_code, index)), model, sourceUpdatedAt: fetchedAt };
    const fields = { temperatureC: at(hourly.temperature_2m, index), humidityPercent: at(hourly.relative_humidity_2m, index), precipitationMm: at(hourly.precipitation, index), cloudCoverPercent: at(hourly.cloud_cover, index), visibilityM: at(hourly.visibility, index), windSpeedKmh: at(hourly.wind_speed_10m, index), windDirectionDeg: at(hourly.wind_direction_10m, index), windGustKmh: at(hourly.wind_gusts_10m, index) };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) Object.assign(point, { [key]: value });
    return [point];
  });
  return { model, latitude, longitude, sourceUpdatedAt: fetchedAt, ...(timezone ? { timezone } : {}), points };
}

export class OpenMeteoHourlyForecastProvider {
  private readonly client: OpenMeteoClient;
  private readonly now: () => number;
  constructor(client: OpenMeteoClient, now: () => number = Date.now) { this.client = client; this.now = now; }
  async getForecast(query: { latitude: number; longitude: number; weatherModel: OpenMeteoWeatherModel }): Promise<WeatherHourlyForecast> {
    const key = `${query.latitude.toFixed(5)}:${query.longitude.toFixed(5)}:${query.weatherModel}`;
    const cached = cache.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) return cached.value;
    const payload = await this.client.fetchHourlyForecast(query);
    const value = parseHourlyForecast(payload, query.weatherModel, new Date(now).toISOString());
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
    return value;
  }
}

export function clearHourlyForecastCacheForTests(): void { cache.clear(); }
