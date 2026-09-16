import type { AviationWeather } from "./types.ts";

// METAR normalement horaire ou semi-horaire ; aucune garantie au-delà de 90 min.
export const METAR_MAX_AGE_MS = 90 * 60_000;
export const AVIATION_REFRESH_MS = 10 * 60_000;
export const AVIATION_SOURCE_MAX_AGE_MS = 15 * 60_000;

export type AviationFreshness = { usable: boolean; label: string };

function timestamp(value: string | null): number {
  return value === null ? NaN : Date.parse(value);
}

function utcLabel(time: number): string {
  return new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function tafWindow(raw: string | null, issuedAt: number): [number, number] | null {
  const match = raw?.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  if (!match || !Number.isFinite(issuedAt)) return null;
  const [, startDay, startHour, endDay, endHour] = match.map(Number);
  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startHour > 23 || endHour > 24) return null;
  const issued = new Date(issuedAt);
  const candidates = (day: number, hour: number) => [-1, 0, 1].flatMap((offset) => {
    const date = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() + offset, day));
    if (date.getUTCDate() !== day) return [];
    return [date.getTime() + hour * 3_600_000];
  });
  const start = candidates(startDay, startHour).sort((a, b) => Math.abs(a - issuedAt) - Math.abs(b - issuedAt))[0];
  const end = candidates(endDay, endHour).filter((time) => time > start && time - start <= 48 * 3_600_000).sort((a, b) => a - b)[0];
  return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
}

export function aviationFreshness(data: AviationWeather, product: "metar" | "taf", now: number): AviationFreshness {
  const raw = product === "metar" ? data.metarRaw : data.tafRaw;
  if (!raw) return { usable: false, label: "Bulletin indisponible" };
  const issuedAt = timestamp(product === "metar" ? data.metarIssuedAt : data.tafIssuedAt);
  const fetchedAt = timestamp(data.sourceUpdatedAt);
  const emission = Number.isFinite(issuedAt)
    ? `Émis le ${utcLabel(issuedAt)} · âge ${Math.max(0, Math.floor((now - issuedAt) / 60_000))} min`
    : "Heure d’émission inconnue";
  const source = Number.isFinite(fetchedAt) ? ` · récupéré le ${utcLabel(fetchedAt)}` : "";
  const reasons: string[] = [];
  if (data.status === "STALE") reasons.push("donnée ancienne/périmée conservée, actualisation échouée");
  if (!Number.isFinite(issuedAt) || issuedAt > now + 5 * 60_000) reasons.push("fraîcheur non vérifiable");
  if (!Number.isFinite(fetchedAt) || fetchedAt > now + 5 * 60_000 || now - fetchedAt >= AVIATION_SOURCE_MAX_AGE_MS) reasons.push("actualisation ancienne ou non vérifiable");
  if (product === "metar" && now - issuedAt >= METAR_MAX_AGE_MS) reasons.push("METAR périmé (90 min ou plus)");
  if (product === "taf") {
    const window = tafWindow(raw, issuedAt);
    if (/\b(?:CNL|NIL)\b/.test(raw)) reasons.push("TAF annulé ou indisponible");
    else if (!window) reasons.push("validité TAF non vérifiable");
    else if (now < window[0]) reasons.push("TAF pas encore valide");
    else if (now >= window[1]) reasons.push("TAF périmé (validité terminée)");
  }
  return { usable: reasons.length === 0, label: `${emission}${source} · ${reasons.length ? reasons.join(" · ") : "récent"}` };
}

/** Un échec ne rajeunit jamais la dernière donnée ni ne mélange les aérodromes. */
export function retainStaleAviation(previous: AviationWeather | null, airport: string | null): AviationWeather | null {
  return previous?.airport === airport ? { ...previous, status: "STALE" } : null;
}
