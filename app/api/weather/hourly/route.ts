import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";
import { OpenMeteoHourlyForecastProvider } from "../../../lib/weather/openMeteo/hourlyForecast";
import { OPEN_METEO_WEATHER_MODELS, type OpenMeteoWeatherModel } from "../../../lib/weather/openMeteo/types";

const provider = new OpenMeteoHourlyForecastProvider(createOpenMeteoClient(getOpenMeteoServerConfig()));
function numberParam(params: URLSearchParams, key: string): number | null { const raw = params.get(key); if (raw === null || !raw.trim()) return null; const value = Number(raw); return Number.isFinite(value) ? value : null; }

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = numberParam(params, "lat");
  const longitude = numberParam(params, "lon");
  const weatherModel = params.get("weatherModel")?.trim();
  if (latitude === null || longitude === null || !weatherModel || !OPEN_METEO_WEATHER_MODELS.includes(weatherModel)) return Response.json({ error: { code: "INVALID_REQUEST", message: "lat, lon et weatherModel supporté sont requis." } }, { status: 400 });
  try { return Response.json({ data: await provider.getForecast({ latitude, longitude, weatherModel: weatherModel as OpenMeteoWeatherModel }) }); }
  catch { return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Le service météo est indisponible." } }, { status: 502 }); }
}
