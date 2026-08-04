import type { JournalFlight } from "./journalMockData.ts";

export const UNKNOWN_DEPARTURE = "Départ inconnu";
export const UNKNOWN_ARRIVAL = "Arrivée inconnue";

export type FlightPlaceIdentity = Readonly<{
  icaoCode?: string | null;
  aerodromeName?: string | null;
  municipality?: string | null;
  preparedSiteName?: string | null;
  /** Vrai uniquement après correspondance explicite à l'emprise ou au point publié de l'aérodrome. */
  identifiedAerodrome?: boolean;
}>;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function selectFlightPlaceName(
  place: FlightPlaceIdentity,
  fallback: string,
): string {
  if (place.identifiedAerodrome) {
    const icao = clean(place.icaoCode)?.toUpperCase();
    if (icao && /^[A-Z]{4}$/.test(icao)) return icao;
    const aerodrome = clean(place.aerodromeName);
    if (aerodrome) return aerodrome;
  }
  return clean(place.municipality) ?? clean(place.preparedSiteName) ?? fallback;
}

export function formatJournalTakeoffTime(startedAt: number, timeZone?: string): string {
  if (!Number.isFinite(startedAt)) return "—:—";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(startedAt);
}

export function buildGeneratedFlightTitle({
  departure,
  arrival,
}: Pick<JournalFlight, "departure" | "arrival">): string {
  const from = clean(departure) ?? UNKNOWN_DEPARTURE;
  const to = clean(arrival) ?? UNKNOWN_ARRIVAL;
  return `${from} → ${to}`;
}

export function buildFactualFlightLabel(flight: Pick<JournalFlight, "departure" | "arrival" | "takeoffTime">): string {
  return `${buildGeneratedFlightTitle(flight)} · ${clean(flight.takeoffTime) ?? "—:—"}`;
}

export function getJournalFlightDisplayTitle(flight: JournalFlight): string {
  return clean(flight.customTitle) ?? clean(flight.generatedTitle) ?? buildGeneratedFlightTitle(flight);
}

export function withoutCustomFlightTitle<T extends JournalFlight>(flight: T): T {
  const next = { ...flight };
  delete next.customTitle;
  return next;
}
