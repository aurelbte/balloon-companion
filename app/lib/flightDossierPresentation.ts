import { isValidTimeZone } from "./timeZone.ts";
import { kmhToKnots } from "./unitPreferences.ts";
export type DossierWindUnit = "km/h" | "m/s" | "kt";
export function dossierWindUnit(value?: DossierWindUnit | null): DossierWindUnit {
  if (value === null || value === undefined) return "km/h";
  if (value === "km/h" || value === "m/s" || value === "kt") return value;
  throw new Error("Unité de vent du dossier invalide.");
}
export function dossierWind(value: number | null | undefined, sourceUnit: "m/s" | "km/h", unit: DossierWindUnit): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const kmh = sourceUnit === "m/s" ? value * 3.6 : value;
  return unit === "m/s" ? kmh / 3.6 : unit === "kt" ? kmhToKnots(kmh) : kmh;
}
/** The source pair is never swapped, clamped or replaced. */
export function dossierArrivalWindWarning(point: { speedKmh: number | null; gustKmh: number | null }): string | null {
  return point.speedKmh !== null && point.gustKmh !== null && Number.isFinite(point.speedKmh) && Number.isFinite(point.gustKmh) && point.gustKmh < point.speedKmh ? "Rafales inférieures au vent : valeurs source conservées, cohérence à vérifier." : null;
}
export function dossierTimeZone(value?: string): string | null { return value && isValidTimeZone(value) ? value : null; }
export function dossierLocalTime(value: string | null | undefined, timeZone?: string, compact = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "indisponible";
  const instant = new Date(value), zone = dossierTimeZone(timeZone);
  const seconds = instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0;
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", ...(compact ? {} : { year: "numeric" as const }), hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" as const } : {}), ...(instant.getUTCMilliseconds() ? { fractionalSecondDigits: 3 as const } : {}), hourCycle: "h23" };
  const utc = new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(instant);
  if (!zone || zone === "UTC") return `${utc} UTC`;
  const local = new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: zone, timeZoneName: "shortOffset" }).format(instant);
  return `${local} (${utc} UTC)`;
}
