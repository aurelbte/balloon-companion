import type { GroundTemperatureProvider } from "./types";

const CACHE_PREFIX = "balloon-companion:ground-temperature:v1:";

type ApiPayload = {
  data?: {
    temperatureC: number;
    sourceModel: string;
    forecastRun: string;
    validTime: string;
    fetchedAt: string;
  };
  error?: { message?: string };
};

function cacheKey(input: { latitude: number; longitude: number; dateTime: string; weatherModel: string }): string {
  return `${CACHE_PREFIX}${JSON.stringify([input.latitude, input.longitude, input.dateTime, input.weatherModel])}`;
}

export class OpenMeteoGroundTemperatureProvider implements GroundTemperatureProvider {
  async getGroundTemperature(input: { latitude: number; longitude: number; dateTime: string; weatherModel: string }) {
    const key = cacheKey(input);
    if (typeof window !== "undefined") {
      const resolvedKey = window.localStorage.getItem(`${key}:latest`);
      const cached = resolvedKey ? window.localStorage.getItem(resolvedKey) : null;
      if (cached) return JSON.parse(cached) as NonNullable<ApiPayload["data"]>;
    }
    const params = new URLSearchParams({ lat: String(input.latitude), lon: String(input.longitude), validAt: input.dateTime, weatherModel: input.weatherModel });
    const response = await fetch(`/api/weather/ground-temperature?${params}`, { headers: { accept: "application/json" } });
    const payload = await response.json() as ApiPayload;
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Température au sol indisponible");
    if (typeof window !== "undefined") {
      const resolvedKey = `${key}:run:${payload.data.forecastRun}`;
      window.localStorage.setItem(resolvedKey, JSON.stringify(payload.data));
      window.localStorage.setItem(`${key}:latest`, resolvedKey);
    }
    return payload.data;
  }
}
