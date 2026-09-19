import { landingWeatherSamplePoints } from "../../../lib/trajectoryArrivalSummary";
import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";
import { parseHourlyForecast } from "../../../lib/weather/openMeteo/hourlyForecast";
import { OPEN_METEO_WEATHER_MODELS, type OpenMeteoWeatherModel } from "../../../lib/weather/openMeteo/types";
import { isValidCoordinate } from "../../../lib/trajectory/validation";
import { setBoundedTtlCacheEntry } from "../../../lib/boundedTtlCache";

const cache = new Map<string, { expiresAt: number; data: unknown }>();
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 64;

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { latitude?: number; longitude?: number; weatherModel?: string } | null;
  if (!input || !isValidCoordinate({ latitude: input.latitude ?? Number.NaN, longitude: input.longitude ?? Number.NaN }) || !input.weatherModel || !OPEN_METEO_WEATHER_MODELS.includes(input.weatherModel)) {
    return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  const key = `${input.latitude!.toFixed(4)}:${input.longitude!.toFixed(4)}:${input.weatherModel}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Response.json({ data: cached.data });
  try {
    const points = landingWeatherSamplePoints(input.latitude!, input.longitude!);
    const client = createOpenMeteoClient(getOpenMeteoServerConfig());
    const payload = await client.fetchHourlyForecastBatch(points.map((point) => ({ ...point, weatherModel: input.weatherModel as OpenMeteoWeatherModel })));
    const payloads = Array.isArray(payload) ? payload : [payload];
    const fetchedAt = new Date().toISOString();
    const data = payloads.map((item) => parseHourlyForecast(item, input.weatherModel as OpenMeteoWeatherModel, fetchedAt));
    const now = Date.now();
    setBoundedTtlCacheEntry(cache, key, { expiresAt: now + CACHE_TTL_MS, data }, now, MAX_CACHE_ENTRIES);
    return Response.json({ data });
  } catch {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 502 });
  }
}
