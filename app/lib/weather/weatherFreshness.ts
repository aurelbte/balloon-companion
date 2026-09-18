export type WeatherFreshness = "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
export const HOURLY_POLICY = { fresh: 30 * 60_000, expired: 2 * 3_600_000 };
export const ANALYSIS_POLICY = { fresh: 30 * 60_000, expired: 3_600_000 };
export type FreshnessPolicy = typeof HOURLY_POLICY;
export function weatherRetrievalTimestamp(value: unknown): number {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}
export function classifyWeatherFreshness(now: number, fetchedAt: unknown, policy: FreshnessPolicy): WeatherFreshness {
  const fetched = weatherRetrievalTimestamp(fetchedAt);
  if (!Number.isFinite(now) || !Number.isFinite(fetched) || fetched > now) return "UNKNOWN";
  const age = now - fetched;
  return age <= policy.fresh ? "FRESH" : age <= policy.expired ? "STALE" : "EXPIRED";
}
/** Every contributing source must have a demonstrable retrieval. */
export function oldestWeatherRetrieval(sources: readonly { weatherFetchedAt?: string }[], now = Date.now()): string | undefined {
  if (!sources.length || sources.some(source => !source.weatherFetchedAt || !Number.isFinite(weatherRetrievalTimestamp(source.weatherFetchedAt)) || weatherRetrievalTimestamp(source.weatherFetchedAt) > now)) return undefined;
  return new Date(Math.min(...sources.map(source => Date.parse(source.weatherFetchedAt!)))).toISOString();
}
export function freshnessLabel(status: WeatherFreshness): string {
  return { FRESH: "Récupération météo récente", STALE: "Données météo anciennes", EXPIRED: "Données météo périmées — référence uniquement", UNKNOWN: "Fraîcheur des données météo non vérifiable" }[status];
}
export function retrievalLabel(fetchedAt: unknown, now = Date.now()): string {
  const time = weatherRetrievalTimestamp(fetchedAt);
  if (!Number.isFinite(time) || time > now) return "Heure de récupération inconnue";
  const minutes = Math.floor((now - time) / 60_000);
  return `Données récupérées il y a ${minutes} min · ${new Date(time).toLocaleString("fr-FR")}`;
}
