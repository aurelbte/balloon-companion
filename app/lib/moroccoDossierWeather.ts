import { prepareFlightDossierWeather, type FlightDossierWeatherRequest } from "./flightDossierWeather.ts";
import type { AviationStationLocation } from "./aviation/airportSearch.ts";
import type { AviationWeatherResult } from "./aviation/types.ts";

const HOUR = 3_600_000;
type RecordData = Record<string, unknown>;
const stamp = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value * 1000 : typeof value === "string" && /Z$/.test(value) ? Date.parse(value.replace(" ", "T")) : NaN;
const unavailable = (message: string): AviationWeatherResult => ({ data: null, error: { code: "NO_DATA", message } });

/** No current-weather fallback, no ICAO-only cache, no inferred run publication time. */
export async function loadMoroccoHistoricalAviation(input: {
  airport: string; product: "metar" | "taf"; referenceAt: string; validAt: string;
  now?: number; fetchImpl?: typeof fetch;
}): Promise<AviationWeatherResult & { provenance?: { receivedAt: string } }> {
  const now = input.now ?? Date.now();
  const reference = Date.parse(input.referenceAt), valid = Date.parse(input.validAt);
  if (!Number.isFinite(reference) || !Number.isFinite(valid) || reference > now || reference < now - 30 * 24 * HOUR)
    return unavailable("Non disponible : référence future ou hors de l’historique AviationWeather.gov (30 jours).");
  const searchAt = Math.min(reference, valid);
  if (searchAt < now - 30 * 24 * HOUR) return unavailable("Non disponible : échéance du vol hors de l’historique AviationWeather.gov (30 jours).");
  const url = new URL(`https://aviationweather.gov/api/data/${input.product}`);
  url.searchParams.set("ids", input.airport);
  url.searchParams.set("format", "json");
  url.searchParams.set("date", new Date(searchAt).toISOString());
  if (input.product === "taf") url.searchParams.set("time", "issue");
  else url.searchParams.set("hours", "24");
  try {
    const response = await (input.fetchImpl ?? fetch)(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Balloon-Companion/1.0" }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 204) return unavailable("Non disponible : aucun bulletin historique.");
    if (!response.ok) throw new Error(`AviationWeather.gov ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Réponse historique invalide");
    const issued = (row: RecordData) => stamp(input.product === "taf" ? row.issueTime : row.reportTime);
    const received = (row: RecordData) => stamp(input.product === "taf" ? row.dbPopTime : row.receiptTime);
    const rows = payload.filter((row): row is RecordData => !!row && typeof row === "object" && row.icaoId === input.airport);
    // Keep the latest known version before checking applicability: never resurrect a superseded TAF.
    const row = rows.filter(row => issued(row) > 0 && received(row) > 0 && issued(row) <= searchAt && received(row) <= reference)
      .sort((a, b) => issued(b) - issued(a) || received(b) - received(a))[0];
    if (!row) return unavailable(rows.length ? "Disponibilité non attestée : émission/réception avant la référence non vérifiable." : "Non disponible : aucun bulletin historique.");
    const raw = input.product === "taf" ? row.rawTAF : row.rawOb;
    if (typeof raw !== "string" || !raw.trim() || /\b(?:CNL|NIL)\b/.test(raw)) return unavailable("Non disponible : bulletin absent ou annulé.");
    const observation = stamp(row.obsTime);
    const applicable = input.product === "taf"
      ? stamp(row.validTimeFrom) <= valid && valid < stamp(row.validTimeTo)
      : observation <= Math.min(valid, reference) && valid - observation < 90 * 60_000;
    if (!applicable) return unavailable("Non disponible : bulletin connu à la référence mais non applicable à cette échéance du vol (METAR : observation, pas prévision).");
    return { data: {
      airport: input.airport, metarRaw: input.product === "metar" ? raw : null, tafRaw: input.product === "taf" ? raw : null,
      metarIssuedAt: input.product === "metar" ? new Date(issued(row)).toISOString() : null,
      tafIssuedAt: input.product === "taf" ? new Date(issued(row)).toISOString() : null,
      sourceUpdatedAt: new Date(now).toISOString(), status: "PARTIAL",
    }, error: null, provenance: { receivedAt: new Date(received(row)).toISOString() } };
  } catch {
    return unavailable("Non disponible : acquisition historique AviationWeather.gov échouée ; aucune substitution actuelle.");
  }
}

export async function prepareMoroccoDossierWeather(input: FlightDossierWeatherRequest & { availabilityReferenceAt: string }, services: {
  stations(): Promise<AviationStationLocation[]>; now?: () => number; fetchImpl?: typeof fetch;
}) {
  const now = (services.now ?? Date.now)();
  const blocked = "Disponibilité non attestée : aucun run Single Runs archivé avec modèle, variables et disponibilité avant la référence vérifiables. Aucune prévision actuelle substituée.";
  const data = await prepareFlightDossierWeather(input, {
    now: () => now, stations: services.stations,
    aviation: async () => unavailable("Non disponible"),
    altitude: async () => { throw new Error(blocked); },
    ground: async () => { throw new Error(blocked); },
  });
  await Promise.all((["departure", "landing"] as const).flatMap(location => (["metar", "taf"] as const).map(async product => {
    const item = data.aviation[location][product];
    if (!item.station) return;
    const result = await loadMoroccoHistoricalAviation({ airport: item.station.icao, product, referenceAt: input.availabilityReferenceAt, validAt: input[location].timestamp, now, fetchImpl: services.fetchImpl });
    item.result = result;
    item.status = item.result.data ? "AVAILABLE" : "UNAVAILABLE";
    item.freshness = { usable: !!item.result.data, label: result.data ? `Historique AviationWeather.gov ; reçu : ${result.provenance!.receivedAt}. Émission/réception avant ${input.availabilityReferenceAt}. Échéance du vol : ${input[location].timestamp}.` : result.error?.message ?? "Non disponible" };
  })));
  data.notices = [
    `Limite de disponibilité des sources : ${input.availabilityReferenceAt} (UTC). Récupération : ${data.preparedAt}. Les échéances du vol sont conservées.`,
    "METAR : observations historiques uniquement, jamais prévisions d’atterrissage. TAF : dernière version connue et applicable à l’échéance du vol.",
    `Modèle demandé : ${input.weatherModel}, fournisseur Open-Meteo. ${blocked}`,
    "Index actuel des stations : il ne prouve pas leur couverture historique. La distance ne garantit pas la représentativité locale.",
  ];
  return { ...data, availabilityReferenceAt: input.availabilityReferenceAt };
}
