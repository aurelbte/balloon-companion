import type { NormalizedWeatherCode, OpenMeteoClient, OpenMeteoWeatherModel, WeatherHourlyForecast, WeatherHourlyPoint } from "./types.ts";

type RecordValue = Record<string, unknown>;
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { expiresAt: number; value: WeatherHourlyForecast }>();

function record(value: unknown): RecordValue | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null; }
function optionalNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function at(values: unknown, index: number): number | undefined { return Array.isArray(values) ? optionalNumber(values[index]) : undefined; }

export function normalizeWeatherCode(value: number | undefined): NormalizedWeatherCode {
  if (value === undefined) return "UNKNOWN";
  if (value === 0) return "CLEAR";
  if (value === 1 || value === 2) return "PARTLY_CLOUDY";
  if (value === 3) return "OVERCAST";
  if (value === 45 || value === 48) return "FOG";
  if ([51, 53, 55, 56, 57, 61, 63, 66, 80, 81].includes(value)) return "RAIN";
  if ([65, 67, 82].includes(value)) return "HEAVY_RAIN";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "SNOW";
  if (value >= 95 && value <= 99) return "THUNDERSTORM";
  return "UNKNOWN";
}

export function parseHourlyForecast(payload: unknown, model: OpenMeteoWeatherModel, fetchedAt = new Date().toISOString()): WeatherHourlyForecast {
  const root = record(payload);
  const hourly = record(root?.hourly);
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const latitude = optionalNumber(root?.latitude);
  const longitude = optionalNumber(root?.longitude);
  if (latitude === undefined || longitude === undefined || !hourly) throw new Error("Réponse météo horaire invalide.");
  const points = times.flatMap<WeatherHourlyPoint>((timestamp, index) => {
    if (typeof timestamp !== "string" || !timestamp.trim()) return [];
    const point: WeatherHourlyPoint = { timestamp, weatherCode: normalizeWeatherCode(at(hourly.weather_code, index)), model, sourceUpdatedAt: fetchedAt };
    const fields = { temperatureC: at(hourly.temperature_2m, index), humidityPercent: at(hourly.relative_humidity_2m, index), precipitationMm: at(hourly.precipitation, index), cloudCoverPercent: at(hourly.cloud_cover, index), visibilityM: at(hourly.visibility, index), windSpeedKmh: at(hourly.wind_speed_10m, index), windDirectionDeg: at(hourly.wind_direction_10m, index), windGustKmh: at(hourly.wind_gusts_10m, index) };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) Object.assign(point, { [key]: value });
    return [point];
  });
  return { model, latitude, longitude, sourceUpdatedAt: fetchedAt, points };
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
