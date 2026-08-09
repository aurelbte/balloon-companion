import { DEMO_OPENING_BALANCE } from "./flightCompletion.ts";

export type AscensionFunction = "Pilote" | "Élève";
export type AscensionFlightType = "Jour" | "Nuit";
export type AscensionBalloonType = "Air chaud" | "Gaz";

export type Ascension = {
  id: string;
  date: string;
  dateIso: string;
  time?: string;
  departure: string;
  arrival: string;
  registration: string;
  balloonModel: string;
  balloonType: AscensionBalloonType;
  function: AscensionFunction;
  flightType: AscensionFlightType;
  maximumAltitudeM: number | null;
  officialDurationMinutes: number;
  observations: string;
};

export function sortAscensionsNewestFirst(
  ascensions: readonly Ascension[],
): Ascension[] {
  return [...ascensions].sort((left, right) =>
    right.dateIso.localeCompare(left.dateIso) ||
    (right.time ?? "").localeCompare(left.time ?? "") ||
    right.id.localeCompare(left.id),
  );
}

export type AscensionOpeningBalance = {
  confirmed: boolean;
  ascensions: number | null;
  officialDurationMinutes: number | null;
};

export const ASCENSION_OPENING_BALANCE: AscensionOpeningBalance = DEMO_OPENING_BALANCE;

export const ASCENSIONS: readonly Ascension[] = [
  {
    id: "2026-07-29-lfqo-merignies",
    date: "29 juillet 2026",
    dateIso: "2026-07-29",
    departure: "LFQO",
    arrival: "Mérignies",
    registration: "F-HLFM",
    balloonModel: "Cameron Z105",
    balloonType: "Air chaud",
    function: "Pilote",
    flightType: "Jour",
    maximumAltitudeM: 982,
    officialDurationMinutes: 60,
    observations: "Ascension locale au départ de LFQO.",
  },
  {
    id: "2026-07-18-bondues-templeuve",
    date: "18 juillet 2026",
    dateIso: "2026-07-18",
    departure: "Bondues",
    arrival: "Templeuve",
    registration: "F-HOBA",
    balloonModel: "Cameron Z350",
    balloonType: "Air chaud",
    function: "Pilote",
    flightType: "Jour",
    maximumAltitudeM: 815,
    officialDurationMinutes: 47,
    observations: "Atterrissage à Templeuve.",
  },
  {
    id: "2026-07-06-hesdin-aire",
    date: "6 juillet 2026",
    dateIso: "2026-07-06",
    departure: "Hesdin",
    arrival: "Aire-sur-la-Lys",
    registration: "F-HMIG",
    balloonModel: "Cameron Z350",
    balloonType: "Air chaud",
    function: "Pilote",
    flightType: "Jour",
    maximumAltitudeM: 1_110,
    officialDurationMinutes: 65,
    observations: "Ascension matinale vers Aire-sur-la-Lys.",
  },
];

export function getAscension(id: string): Ascension | null {
  return ASCENSIONS.find((ascension) => ascension.id === id) ?? null;
}

export function getAscensionAutomaticName(ascension: Ascension): string {
  return `${ascension.departure} → ${ascension.arrival}`;
}

export function formatOfficialDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} h`;
  return `${hours} h ${String(remainingMinutes).padStart(2, "0")}`;
}
