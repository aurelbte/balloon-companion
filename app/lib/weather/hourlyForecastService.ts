import type { OpenMeteoWeatherModel, WeatherHourlyForecast } from "./openMeteo/types.ts";

export async function loadHourlyWeatherForecast(query: { latitude: number; longitude: number; weatherModel: OpenMeteoWeatherModel }, signal?: AbortSignal): Promise<WeatherHourlyForecast> {
  const params = new URLSearchParams({ lat: String(query.latitude), lon: String(query.longitude), weatherModel: query.weatherModel });
  const response = await fetch(`/api/weather/hourly?${params}`, { signal });
  const payload: unknown = await response.json();
  if (!response.ok || typeof payload !== "object" || payload === null || !("data" in payload)) throw new Error("Prévisions météo indisponibles.");
  return (payload as { data: WeatherHourlyForecast }).data;
}
