import type { ElevationProvider, ElevationResult } from "./types.ts";

const CACHE_KEY = "balloon-companion-load-elevations-v1";
type ElevationCache = Record<string, ElevationResult>;

function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function readCache(): ElevationCache {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as ElevationCache : {};
  } catch {
    return {};
  }
}

export class ApiElevationProvider implements ElevationProvider {
  async getElevation({ latitude, longitude }: { latitude: number; longitude: number }): Promise<ElevationResult> {
    const key = coordinateKey(latitude, longitude);
    const cached = readCache()[key];
    if (cached && Number.isFinite(cached.elevationMslM)) return cached;
    const response = await fetch(`/api/elevation?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
    const payload: unknown = await response.json();
    if (!response.ok || !payload || typeof payload !== "object") throw new Error("ELEVATION_UNAVAILABLE");
    const data = "data" in payload && payload.data && typeof payload.data === "object" ? payload.data : null;
    const elevationMslM = data && "elevationAmslM" in data ? data.elevationAmslM : undefined;
    if (typeof elevationMslM !== "number" || !Number.isFinite(elevationMslM)) throw new Error("ELEVATION_UNAVAILABLE");
    const result: ElevationResult = {
      elevationMslM,
      source: "provider" in payload && typeof payload.provider === "string" ? payload.provider : "Source d’élévation non précisée",
      fetchedAt: new Date().toISOString(),
    };
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [key]: result })); } catch { /* Le cache reste facultatif. */ }
    }
    return result;
  }
}
