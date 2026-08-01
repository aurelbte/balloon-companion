import type { GroundTemperatureProvider } from "./types";

const CACHE_PREFIX = "balloon-companion:ground-temperature:v1:";

type ApiPayload = {
  ok?: boolean;
  temperatureC?: number;
  sourceModel?: string;
  forecastRun?: string;
  validTime?: string;
  offsetMinutes?: number;
  provider?: string;
  fetchedAt?: string;
  reasonCode?: string;
  message?: string;
};

type GroundTemperatureData = { temperatureC: number; sourceModel: string; forecastRun: string; validTime: string; forecastOffsetMinutes: number; provider: string; fetchedAt: string };

function cacheKey(input: { latitude: number; longitude: number; dateTime: string; weatherModel: string }): string {
  return `${CACHE_PREFIX}${JSON.stringify([input.latitude, input.longitude, input.dateTime, input.weatherModel])}`;
}

export class OpenMeteoGroundTemperatureProvider implements GroundTemperatureProvider {
  async getGroundTemperature(input: { latitude: number; longitude: number; dateTime: string; weatherModel: string }) {
    const key = cacheKey(input);
    if (typeof window !== "undefined") {
      const resolvedKey = window.localStorage.getItem(`${key}:latest`);
      const cached = resolvedKey ? window.localStorage.getItem(resolvedKey) : null;
      if (cached) return JSON.parse(cached) as GroundTemperatureData;
    }
    const params = new URLSearchParams({ lat: String(input.latitude), lon: String(input.longitude), validAt: input.dateTime, weatherModel: input.weatherModel });
    const response = await fetch(`/api/weather/ground-temperature?${params}`, { headers: { accept: "application/json" } });
    const payload = await response.json() as ApiPayload;
    if (!response.ok || payload.ok !== true || typeof payload.temperatureC !== "number" || !Number.isFinite(payload.temperatureC) || !payload.validTime) {
      const error = new Error(payload.message ?? "Température au sol indisponible");
      error.name = payload.reasonCode ?? "INVALID_OPEN_METEO_RESPONSE";
      throw error;
    }
    const data: GroundTemperatureData = { temperatureC: payload.temperatureC, sourceModel: payload.sourceModel ?? "Open-Meteo", forecastRun: payload.forecastRun ?? "Non communiqué par Open-Meteo", validTime: payload.validTime, forecastOffsetMinutes: payload.offsetMinutes ?? 0, provider: payload.provider ?? "Open-Meteo", fetchedAt: payload.fetchedAt ?? new Date().toISOString() };
    if (typeof window !== "undefined") {
      const resolvedKey = `${key}:run:${data.forecastRun}`;
      window.localStorage.setItem(resolvedKey, JSON.stringify(data));
      window.localStorage.setItem(`${key}:latest`, resolvedKey);
    }
    return data;
  }
}
