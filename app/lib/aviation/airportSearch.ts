import { normalizeAirportIcao } from "./aviationWeather.ts";

export type AviationAirportSearchResult = { icao: string; name: string; locality?: string };
type SourceStation = Record<string, unknown>;
const STATIONS_URL = "https://aviationweather.gov/data/cache/stations.cache.json.gz";
const CACHE_TTL_MS = 24 * 60 * 60_000;
let cache: { expiresAt: number; stations: AviationAirportSearchResult[] } | null = null;

function text(item: SourceStation, ...keys: string[]): string | undefined { for (const key of keys) { const value = item[key]; if (typeof value === "string" && value.trim()) return value.trim(); } }
export function normalizeStations(payload: unknown): AviationAirportSearchResult[] {
  const items = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { features?: unknown }).features) ? (payload as { features: Array<{ properties?: SourceStation }> }).features.map(({ properties }) => properties ?? {}) : [];
  return items.flatMap((item: SourceStation) => { const icao = normalizeAirportIcao(text(item, "icaoId", "icao", "stationId", "id")); const name = text(item, "site", "name", "stationName"); const locality = text(item, "city", "locality", "state", "country"); return icao && name ? [{ icao, name, ...(locality ? { locality } : {}) }] : []; }).filter((item, index, all) => all.findIndex(({ icao }) => icao === item.icao) === index);
}

function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR"); }
export function searchStations(stations: readonly AviationAirportSearchResult[], query: string, limit = 8): AviationAirportSearchResult[] {
  const needle = normalized(query.trim());
  if (needle.length < 2) return [];
  return stations.filter(({ icao, name, locality }) => normalized(`${icao} ${name} ${locality ?? ""}`).includes(needle)).sort((left, right) => { const leftIcao = normalized(left.icao).startsWith(needle) ? 0 : 1; const rightIcao = normalized(right.icao).startsWith(needle) ? 0 : 1; return leftIcao - rightIcao || left.name.localeCompare(right.name, "fr"); }).slice(0, limit);
}

export async function searchAviationAirports(query: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<AviationAirportSearchResult[]> {
  if (!cache || cache.expiresAt <= now) { const response = await fetchImpl(STATIONS_URL, { headers: { accept: "application/json", "user-agent": "Balloon-Companion/1.0 (aviation station search)" }, cache: "force-cache" }); if (!response.ok) throw new Error("Station metadata unavailable"); cache = { expiresAt: now + CACHE_TTL_MS, stations: normalizeStations(await response.json()) }; }
  return searchStations(cache.stations, query);
}
export function clearAirportSearchCacheForTests(): void { cache = null; }
