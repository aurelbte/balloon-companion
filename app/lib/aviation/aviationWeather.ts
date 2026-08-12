import type { AviationWeather, AviationWeatherResult } from "./types.ts";

const BASE_URL = "https://aviationweather.gov/api/data";
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; data: AviationWeather }>();

export function normalizeAirportIcao(value: string | null | undefined): string | null {
  const airport = value?.trim().toUpperCase();
  return airport && /^[A-Z0-9]{4}$/.test(airport) ? airport : null;
}

function issuedAtFromRaw(raw: string | null, now: Date): string | null {
  const match = raw?.match(/(?:^|\s)(\d{2})(\d{2})(\d{2})Z(?:\s|$)/);
  if (!match) return null;
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Number(match[1]), Number(match[2]), Number(match[3])));
  if (candidate.getTime() - now.getTime() > 15 * 86_400_000) candidate.setUTCMonth(candidate.getUTCMonth() - 1);
  else if (now.getTime() - candidate.getTime() > 20 * 86_400_000) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : null;
}

async function fetchRaw(fetchImpl: typeof fetch, product: "metar" | "taf", airport: string): Promise<string | null> {
  const url = new URL(`${BASE_URL}/${product}`);
  url.searchParams.set("ids", airport);
  url.searchParams.set("format", "raw");
  const response = await fetchImpl(url, { headers: { accept: "text/plain", "user-agent": "Balloon-Companion/1.0" }, cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`AviationWeather.gov ${response.status}`);
  const raw = (await response.text()).trim();
  return raw || null;
}

export async function loadAviationWeather(input: { airport: string; fetchImpl?: typeof fetch; now?: () => number }): Promise<AviationWeatherResult> {
  const airport = normalizeAirportIcao(input.airport);
  if (!airport) return { data: null, error: { code: "NO_AIRPORT", message: "Aucun aérodrome associé au favori météo." } };
  const nowMs = (input.now ?? Date.now)();
  const cached = cache.get(airport);
  if (cached && cached.expiresAt > nowMs) return { data: cached.data, error: null };
  try {
    const [metar, taf] = await Promise.allSettled([fetchRaw(input.fetchImpl ?? fetch, "metar", airport), fetchRaw(input.fetchImpl ?? fetch, "taf", airport)]);
    const metarRaw = metar.status === "fulfilled" ? metar.value : cached?.data.metarRaw ?? null;
    const tafRaw = taf.status === "fulfilled" ? taf.value : cached?.data.tafRaw ?? null;
    if (!metarRaw && !tafRaw) {
      if (cached) return { data: { ...cached.data, status: "STALE" }, error: null };
      return { data: null, error: { code: metar.status === "rejected" || taf.status === "rejected" ? "SOURCE_UNAVAILABLE" : "NO_DATA", message: "Aucune donnée METAR ou TAF disponible pour cet aérodrome." } };
    }
    const updatedAt = new Date(nowMs);
    const sourceFailed = metar.status === "rejected" || taf.status === "rejected";
    const data: AviationWeather = { airport, metarRaw, tafRaw, metarIssuedAt: issuedAtFromRaw(metarRaw, updatedAt), tafIssuedAt: issuedAtFromRaw(tafRaw, updatedAt), sourceUpdatedAt: sourceFailed && cached ? cached.data.sourceUpdatedAt : updatedAt.toISOString(), status: sourceFailed && cached ? "STALE" : metarRaw && tafRaw ? "AVAILABLE" : "PARTIAL" };
    cache.set(airport, { expiresAt: nowMs + CACHE_TTL_MS, data });
    return { data, error: null };
  } catch {
    if (cached) return { data: { ...cached.data, status: "STALE" }, error: null };
    return { data: null, error: { code: "SOURCE_UNAVAILABLE", message: "Les données aviation sont momentanément indisponibles." } };
  }
}

export function clearAviationWeatherCacheForTests(): void { cache.clear(); }
