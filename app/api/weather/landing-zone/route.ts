import { landingWeatherSamplePoints } from "../../../lib/trajectoryArrivalSummary";
import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";
import { parseHourlyForecast } from "../../../lib/weather/openMeteo/hourlyForecast";
import { OPEN_METEO_WEATHER_MODELS, type OpenMeteoWeatherModel } from "../../../lib/weather/openMeteo/types";

const cache = new Map<string, { expiresAt: number; data: unknown }>();
const CACHE_TTL_MS = 15 * 60_000;

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { latitude?: number; longitude?: number; weatherModel?: string } | null;
  if (!input || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || !input.weatherModel || !OPEN_METEO_WEATHER_MODELS.includes(input.weatherModel)) {
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
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return Response.json({ data });
  } catch {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, { status: 502 });
  }
}
