export type MetarDisplay = { wind: string; visibility: string; clouds: string; temperature: string; dewPoint: string; qnh: string };
export type TafPeriodDisplay = { label: string; wind: string; visibility: string; clouds: string };

const value = (match: RegExpMatchArray | null) => match?.[0] ?? "—";
const wind = (raw: string) => value(raw.match(/\b(?:VRB|\d{3})\d{2,3}(?:G\d{2,3})?KT\b/));
const visibility = (raw: string) => value(raw.match(/\b(?:CAVOK|\d{4}|\d+(?:\/\d+)?SM)\b/));
const clouds = (raw: string) => raw.match(/\b(?:NSC|NCD|SKC|CLR|FEW\d{3}|SCT\d{3}|BKN\d{3}|OVC\d{3}|VV\d{3})(?:CB|TCU)?\b/g)?.join(" ") ?? "—";

export function metarDisplay(raw: string): MetarDisplay {
  const temperature = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  return { wind: wind(raw), visibility: visibility(raw), clouds: clouds(raw), temperature: temperature?.[1] ?? "—", dewPoint: temperature?.[2] ?? "—", qnh: value(raw.match(/\bQ\d{4}\b|\bA\d{4}\b/)) };
}

export function tafValidity(raw: string): string { return value(raw.match(/\b\d{4}\/\d{4}\b/)); }

export function tafPeriods(raw: string): TafPeriodDisplay[] {
  const markers = [...raw.matchAll(/\b(?:FM\d{6}|BECMG|TEMPO|PROB(?:30|40))\b/g)];
  const validity = raw.match(/\b\d{4}\/\d{4}\b/);
  const start = validity?.index === undefined ? 0 : validity.index + validity[0].length;
  const slices = [{ label: "Période initiale", start, end: markers[0]?.index ?? raw.length }, ...markers.map((marker, index) => ({ label: marker[0], start: (marker.index ?? 0) + marker[0].length, end: markers[index + 1]?.index ?? raw.length }))];
  return slices.map((period) => { const source = raw.slice(period.start, period.end); return { label: period.label, wind: wind(source), visibility: visibility(source), clouds: clouds(source) }; });
}
