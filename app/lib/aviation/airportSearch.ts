import { gunzipSync } from "node:zlib";
import { normalizeAirportIcao } from "./aviationWeather.ts";

export type AviationAirportSearchResult = { icao: string; name: string; locality?: string };
export type AviationStationLocation = AviationAirportSearchResult & {
  latitude: number; longitude: number; products: Array<"METAR" | "TAF">;
};
type SourceStation = Record<string, unknown>;
const STATIONS_URL = "https://aviationweather.gov/data/cache/stations.cache.json.gz";
const CACHE_TTL_MS = 24 * 60 * 60_000;
let cache: { expiresAt: number; stations: AviationAirportSearchResult[]; locations: AviationStationLocation[] } | null = null;

function text(item: SourceStation, ...keys: string[]): string | undefined { for (const key of keys) { const value = item[key]; if (typeof value === "string" && value.trim()) return value.trim(); } }
export function normalizeStations(payload: unknown): AviationAirportSearchResult[] {
  const items = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { features?: unknown }).features) ? (payload as { features: Array<{ properties?: SourceStation }> }).features.map(({ properties }) => properties ?? {}) : [];
  return items.flatMap((item: SourceStation) => { const icao = normalizeAirportIcao(text(item, "icaoId", "icao", "stationId", "id")); const name = text(item, "site", "name", "stationName"); const locality = text(item, "city", "locality", "state", "country"); return icao && name ? [{ icao, name, ...(locality ? { locality } : {}) }] : []; }).filter((item, index, all) => all.findIndex(({ icao }) => icao === item.icao) === index);
}

/** Only stations explicitly advertising the product are eligible. */
export function normalizeStationLocations(payload: unknown): AviationStationLocation[] {
  const items: SourceStation[] = Array.isArray(payload) ? payload : [];
  return items.flatMap((item) => {
    const station = normalizeStations([item])[0];
    const latitude = item.lat ?? item.latitude;
    const longitude = item.lon ?? item.longitude;
    const products = Array.isArray(item.siteType) ? item.siteType.filter((value): value is "METAR" | "TAF" => value === "METAR" || value === "TAF") : [];
    if (!station || typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !products.length) return [];
    return [{ ...station, latitude, longitude, products }];
  });
}

function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR"); }
function stationScore(station: AviationAirportSearchResult, needle: string): number {
  const icao = normalized(station.icao);
  const name = normalized(station.name);
  const locality = normalized(station.locality ?? "");
  if (icao === needle) return 0;
  if (icao.startsWith(needle)) return 1;
  if (name === needle) return 2;
  if (name.startsWith(needle)) return 3;
  if (name.includes(needle)) return 4;
  if (locality === needle) return 5;
  if (locality.startsWith(needle)) return 6;
  return locality.includes(needle) ? 7 : 8;
}
export function searchStations(stations: readonly AviationAirportSearchResult[], query: string, limit = 8): AviationAirportSearchResult[] {
  const needle = normalized(query.trim());
  if (needle.length < 2) return [];
  return stations
    .filter(({ icao, name, locality }) => [icao, name, locality ?? ""].some((value) => normalized(value).includes(needle)))
    .sort((left, right) => stationScore(left, needle) - stationScore(right, needle) || left.name.localeCompare(right.name, "fr"))
    .slice(0, limit);
}

async function stationPayload(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : new TextDecoder().decode(bytes);
  return JSON.parse(decoded);
}

async function loadStationCache(fetchImpl: typeof fetch, now: number, timeoutMs: number) {
  if (!cache || cache.expiresAt <= now) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(STATIONS_URL, { headers: { accept: "application/json", "user-agent": "Balloon-Companion/1.0 (aviation station search)" }, cache: "force-cache", signal: controller.signal });
      if (!response.ok) throw new Error("Station metadata unavailable");
      const payload = await stationPayload(response);
      cache = { expiresAt: now + CACHE_TTL_MS, stations: normalizeStations(payload), locations: normalizeStationLocations(payload) };
    } finally {
      clearTimeout(timeout);
    }
  }
  return cache;
}

export async function searchAviationAirports(query: string, fetchImpl: typeof fetch = fetch, now = Date.now(), timeoutMs = 15_000): Promise<AviationAirportSearchResult[]> {
  return searchStations((await loadStationCache(fetchImpl, now, timeoutMs)).stations, query);
}

export async function loadAviationStationLocations(fetchImpl: typeof fetch = fetch, now = Date.now(), timeoutMs = 15_000): Promise<AviationStationLocation[]> {
  return (await loadStationCache(fetchImpl, now, timeoutMs)).locations;
}
export function clearAirportSearchCacheForTests(): void { cache = null; }
