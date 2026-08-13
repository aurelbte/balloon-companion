export type MetarDisplay = { wind: string; visibility?: string; clouds?: string; phenomena?: string; cavok: boolean; temperature: string; dewPoint: string; qnh: string };

export function qnhHpaFromMetar(raw: string | null): number | null {
  const match = raw?.match(/\bQ(\d{4})\b/);
  return match ? Number(match[1]) : null;
}
export type TafPeriodDisplay = { label: string; wind: string; visibility?: string; clouds?: string; phenomena?: string; cavok: boolean };

const missing = "—";
const compass = ["Nord", "Nord-Nord-Est", "Nord-Est", "Est-Nord-Est", "Est", "Est-Sud-Est", "Sud-Est", "Sud-Sud-Est", "Sud", "Sud-Sud-Ouest", "Sud-Ouest", "Ouest-Sud-Ouest", "Ouest", "Ouest-Nord-Ouest", "Nord-Ouest", "Nord-Nord-Ouest"];
const signed = (value: string) => `${value.startsWith("M") ? "-" : ""}${Number(value.replace("M", ""))}°C`;
const dayHour = (value: string) => `${Number(value.slice(0, 2))} à ${value.slice(2)}h`;

function readableWind(raw: string): string {
  const match = raw.match(/\b(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (!match) return missing;
  const knots = Number(match[2]);
  const direction = match[1] === "VRB" ? "Variable" : `${compass[Math.round(Number(match[1]) / 22.5) % 16]} (${match[1]}°)`;
  const gust = match[3] ? ` · rafales ${Number(match[3])} kt` : "";
  return `${direction} · ${knots} kt${gust}`;
}

function readableVisibility(raw: string): string {
  if (/\b9999\b/.test(raw)) return "> 10 km";
  const metres = raw.match(/(?:^|\s)(\d{4})(?=\s|$)/);
  if (metres) return `${Number(metres[1]) / 1_000} km`;
  const statuteMiles = raw.match(/\b(\d+(?:\/\d+)?)SM\b/);
  if (!statuteMiles) return missing;
  const [whole, denominator] = statuteMiles[1].split("/").map(Number);
  const miles = denominator ? whole / denominator : whole;
  return `${Math.round(miles * 1.609 * 10) / 10} km`;
}

function readableClouds(raw: string): string | undefined {
  if (/\b(?:CAVOK|NSC|NCD|SKC|CLR)\b/.test(raw)) return undefined;
  const labels: Record<string, string> = { FEW: "Quelques nuages", SCT: "Nuages épars", BKN: "Nuages fragmentés", OVC: "Couvert", VV: "Visibilité verticale" };
  const groups = [...raw.matchAll(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})(?:CB|TCU)?\b/g)];
  return groups.length ? groups.map((group) => `${labels[group[1]]} à ${Number(group[2]) * 100} ft`).join(" · ") : undefined;
}

function readablePhenomena(raw: string): string | undefined {
  const labels: Record<string, string> = { DZ: "Bruine", RA: "Pluie", SN: "Neige", SG: "Neige en grains", PL: "Granules de glace", GR: "Grêle", GS: "Grésil", FG: "Brouillard", BR: "Brume", HZ: "Brume sèche", FU: "Fumée", TS: "Orage", SH: "Averses", FZ: "Précipitations verglaçantes" };
  const found: string[] = [];
  for (const match of raw.matchAll(/(?:^|\s)(?:[-+]|VC)?(?:MI|PR|BC|DR|BL)?(DZ|RA|SN|SG|PL|GR|GS|FG|BR|HZ|FU|TS|SH|FZ)(?:DZ|RA|SN|SG|PL|GR|GS|FG|BR)?(?=\s|$)/g)) { const label = labels[match[1]]; if (label && !found.includes(label)) found.push(label); }
  return found.length ? found.join(" · ") : undefined;
}

export function metarDisplay(raw: string): MetarDisplay {
  const temperature = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  const qnh = qnhHpaFromMetar(raw);
  const altimeter = raw.match(/\bA(\d{4})\b/);
  const cavok = /\bCAVOK\b/.test(raw); const visibility = readableVisibility(raw); const clouds = readableClouds(raw); const phenomena = readablePhenomena(raw);
  return { wind: readableWind(raw), ...(!cavok && visibility !== missing ? { visibility } : {}), ...(clouds ? { clouds } : {}), ...(!cavok && phenomena ? { phenomena } : {}), cavok, temperature: temperature ? signed(temperature[1]) : missing, dewPoint: temperature ? signed(temperature[2]) : missing, qnh: qnh !== null ? `${qnh} hPa` : altimeter ? `${altimeter[1].slice(0, 2)}.${altimeter[1].slice(2)} inHg` : missing };
}

export function tafValidity(raw: string): string {
  const match = raw.match(/\b(\d{4})\/(\d{4})\b/);
  return match ? `du ${dayHour(match[1])} au ${dayHour(match[2])} UTC` : missing;
}

export function tafPeriods(raw: string): TafPeriodDisplay[] {
  const markers = [...raw.matchAll(/\b(?:FM\d{6}|BECMG|TEMPO|PROB(?:30|40))\b/g)];
  const validity = raw.match(/\b\d{4}\/\d{4}\b/);
  const start = validity?.index === undefined ? 0 : validity.index + validity[0].length;
  const label = (marker: string) => marker.startsWith("FM") ? `À partir du ${dayHour(marker.slice(2, 6))} UTC` : marker === "TEMPO" ? "Temporairement" : marker === "BECMG" ? "Évolution" : `Probabilité ${marker.slice(4)} %`;
  const slices = [{ label: "Période initiale", start, end: markers[0]?.index ?? raw.length }, ...markers.map((marker, index) => ({ label: label(marker[0]), start: (marker.index ?? 0) + marker[0].length, end: markers[index + 1]?.index ?? raw.length }))];
  return slices.map((period) => { const source = raw.slice(period.start, period.end); const cavok = /\bCAVOK\b/.test(source); const visibility = readableVisibility(source); const clouds = readableClouds(source); const phenomena = readablePhenomena(source); return { label: period.label, wind: readableWind(source), ...(!cavok && visibility !== missing ? { visibility } : {}), ...(clouds ? { clouds } : {}), ...(!cavok && phenomena ? { phenomena } : {}), cavok }; });
}

type WindGroup = { speed: number; gust?: number };
function windGroups(raw: string): WindGroup[] { return [...raw.matchAll(/\b(?:VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT\b/g)].map((match) => ({ speed: Number(match[1]), ...(match[2] ? { gust: Number(match[2]) } : {}) })); }
function visibilityGroups(raw: string): number[] {
  const values = [...raw.matchAll(/(?:^|\s)(\d{4}|CAVOK)(?=\s|$)/g)].map((match) => match[1] === "CAVOK" || match[1] === "9999" ? 10_000 : Number(match[1]));
  return values;
}

export function aviationAnalysis(metarRaw: string | null, tafRaw: string | null): string {
  const metar = metarRaw ?? "";
  const taf = tafRaw ?? "";
  const all = `${metar} ${taf}`;
  const winds = windGroups(all);
  const visibilities = visibilityGroups(all);
  const sentences: string[] = [];
  if (winds.length > 1) {
    const delta = winds.at(-1)!.speed - winds[0].speed;
    sentences.push(Math.abs(delta) <= 2 ? "Le vent reste globalement stable." : delta > 0 ? "Le vent moyen se renforce au fil de la prévision." : "Le vent moyen faiblit au fil de la prévision.");
  } else if (winds.length === 1) sentences.push(`Le vent observé est de ${winds[0].speed} kt.`);
  const gusts = winds.flatMap(({ gust }) => gust === undefined ? [] : [gust]);
  if (gusts.length) sentences.push(`Des rafales atteignent ${Math.max(...gusts)} kt.`);
  if (visibilities.length > 1 && Math.min(...visibilities.slice(1)) < visibilities[0]) sentences.push("Une baisse de visibilité est annoncée.");
  const phenomena: string[] = [];
  if (/\b(?:FG|BR)\b/.test(all)) phenomena.push("du brouillard ou de la brume");
  if (/\b(?:DZ|RA|SHRA|FZRA)\b/.test(all)) phenomena.push("de la pluie");
  if (/\b(?:TS|TSRA)\b/.test(all)) phenomena.push("des orages");
  if (phenomena.length) sentences.push(`Les données mentionnent ${phenomena.join(", ")}.`);
  if (sentences.length < 4) sentences.push(/\b(?:BECMG|TEMPO|FM\d{6}|PROB(?:30|40))\b/.test(taf) ? "Un changement significatif est annoncé dans le TAF." : "Aucun changement significatif n'est annoncé.");
  return sentences.slice(0, 4).join(" ").slice(0, 300).trim();
}
