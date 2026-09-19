import type { GroundTemperatureProvider } from "./types";
import { isValidTimeZone } from "../timeZone.ts";

const CACHE_PREFIX = "balloon-companion:ground-temperature:v1:";
export const GROUND_TEMPERATURE_PROVIDER_ID = "open-meteo-generic";
// Application refresh policy, not the forecast model's update cadence.
export const GROUND_TEMPERATURE_TTL_MS = 15 * 60_000;
export type GroundTemperatureRequestIdentity = { latitude: number; longitude: number; dateTime: string; provider?: string; timeZone?: string };
export type GroundTemperatureData = { temperatureC: number; sourceModel: string; forecastRun: string; validTime: string; forecastOffsetMinutes: number; provider: string; fetchedAt: string; requestIdentity: GroundTemperatureRequestIdentity };

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return NaN;
  return Date.parse(value);
}
export function canFetchGroundTemperature(input: Partial<GroundTemperatureRequestIdentity>): input is GroundTemperatureRequestIdentity {
  return typeof input.latitude === "number" && Number.isFinite(input.latitude) && input.latitude >= -90 && input.latitude <= 90
    && typeof input.longitude === "number" && Number.isFinite(input.longitude) && input.longitude >= -180 && input.longitude <= 180
    && Number.isFinite(timestamp(input.dateTime))
    && (input.timeZone === undefined || isValidTimeZone(input.timeZone))
    && (input.provider === undefined || input.provider === GROUND_TEMPERATURE_PROVIDER_ID);
}
export function groundTemperatureRequestKey(input: GroundTemperatureRequestIdentity): string {
  return JSON.stringify([input.latitude, input.longitude, input.dateTime, input.provider ?? GROUND_TEMPERATURE_PROVIDER_ID, input.timeZone ?? null]);
}
function cacheKey(input: GroundTemperatureRequestIdentity): string { return `${CACHE_PREFIX}${groundTemperatureRequestKey(input)}`; }

/** The same read-only gate protects persisted cache and the calculation's in-memory input. */
export function usableGroundTemperature(value: unknown, request: GroundTemperatureRequestIdentity, now = Date.now()): GroundTemperatureData | null {
  if (!canFetchGroundTemperature(request) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as GroundTemperatureData;
  if (!data.requestIdentity || !canFetchGroundTemperature(data.requestIdentity) || groundTemperatureRequestKey(data.requestIdentity) !== groundTemperatureRequestKey(request)) return null;
  if (typeof data.temperatureC !== "number" || !Number.isFinite(data.temperatureC) || data.provider !== "Open-Meteo" || data.sourceModel !== "Open-Meteo" || typeof data.forecastRun !== "string" || !data.forecastRun.trim()) return null;
  const fetched = timestamp(data.fetchedAt), valid = timestamp(data.validTime), requested = timestamp(request.dateTime);
  // Reject even small future timestamps: never extend validity through clock skew.
  if (![now, fetched, valid].every(Number.isFinite) || now < fetched || now - fetched > GROUND_TEMPERATURE_TTL_MS) return null;
  const offset = (valid - requested) / 60_000;
  if (Math.abs(offset) > 30 || typeof data.forecastOffsetMinutes !== "number" || !Number.isFinite(data.forecastOffsetMinutes) || Math.abs(data.forecastOffsetMinutes - offset) > 1e-8) return null;
  return data;
}
function unavailable(name = "INVALID_OPEN_METEO_RESPONSE"): Error { const error = new Error("Température au sol indisponible pour le calcul"); error.name = name; return error; }

export class OpenMeteoGroundTemperatureProvider implements GroundTemperatureProvider {
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  async getGroundTemperature(input: GroundTemperatureRequestIdentity & { weatherModel: string; signal?: AbortSignal }): Promise<GroundTemperatureData> {
    if (!canFetchGroundTemperature(input)) throw unavailable("INVALID_TEMPERATURE_REQUEST");
    const identity = { latitude: input.latitude, longitude: input.longitude, dateTime: input.dateTime, provider: input.provider ?? GROUND_TEMPERATURE_PROVIDER_ID, ...(input.timeZone ? { timeZone: input.timeZone } : {}) };
    const key = cacheKey(identity);
    if (typeof window !== "undefined") {
      try {
        const pointer = window.localStorage.getItem(`${key}:latest`);
        if (pointer?.startsWith(`${key}:run:`)) {
          const raw = window.localStorage.getItem(pointer);
          const data = raw ? usableGroundTemperature(JSON.parse(raw), identity, this.now()) : null;
          if (data && pointer === `${key}:run:${data.forecastRun}`) return data;
        }
      } catch { /* Unreadable cache is not evidence of a usable temperature. */ }
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw unavailable("GROUND_TEMPERATURE_UNAVAILABLE_OFFLINE");
    const params = new URLSearchParams({ lat: String(input.latitude), lon: String(input.longitude), validAt: input.dateTime });
    if (input.timeZone) params.set("timeZone", input.timeZone);
    const response = await fetch(`/api/weather/ground-temperature?${params}`, { headers: { accept: "application/json" }, signal: input.signal });
    const payload: unknown = await response.json();
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) throw unavailable();
    const row = payload as Record<string, unknown>;
    const data = usableGroundTemperature({ temperatureC: row.temperatureC, sourceModel: row.sourceModel, forecastRun: row.forecastRun, validTime: row.validTime, forecastOffsetMinutes: row.offsetMinutes, provider: row.provider, fetchedAt: row.fetchedAt, requestIdentity: identity }, identity, this.now());
    if (row.ok !== true || row.requestedTime !== identity.dateTime || !data) throw unavailable();
    if (typeof window !== "undefined") {
      try {
        const resolvedKey = `${key}:run:${data.forecastRun}`;
        window.localStorage.setItem(resolvedKey, JSON.stringify(data));
        window.localStorage.setItem(`${key}:latest`, resolvedKey);
      } catch { /* A validated live response remains usable if optional caching fails. */ }
    }
    return data;
  }
}
