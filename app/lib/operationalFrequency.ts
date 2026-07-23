import type { FlightContext } from "./flightContext.ts";
import type {
  AirspaceGeoJsonProperties,
  OpenAipFrequency,
} from "./openaip.ts";

export type OperationalFrequencyRole =
  | "TWR"
  | "APP"
  | "INFO"
  | "RADAR"
  | "CONTROL"
  | "AFIS"
  | "FIS";

export interface OperationalFrequencyContext {
  status: "AVAILABLE" | "UNAVAILABLE";
  value: string | null;
  stationName: string | null;
  role: OperationalFrequencyRole | null;
  sourceAirspaceId: string | null;
  source: "OPENAIP" | null;
  reason:
    | "OPERATIONAL_ROLE"
    | "UNIQUE_OFFICIAL_FREQUENCY"
    | "NO_CURRENT_AIRSPACE"
    | "UNSUPPORTED_AIRSPACE_TYPE"
    | "AMBIGUOUS_FREQUENCIES"
    | "FIS_LOCALITY_UNCONFIRMED";
}

export interface AirspaceFrequencyPresentation {
  name: string | null;
  value: string;
  isOperational: boolean;
}

const ROLE_PATTERN: Readonly<
  Record<OperationalFrequencyRole, RegExp>
> = {
  TWR: /\b(TWR|TOWER|TOUR)\b/i,
  APP: /\b(APP|APPROACH|APPROCHE)\b/i,
  INFO: /\b(INFO|INFORMATION)\b/i,
  RADAR: /\bRADAR\b/i,
  CONTROL: /\b(CONTROL|CONTROLE|CONTRÔLE|CTL)\b/i,
  AFIS: /\bAFIS\b/i,
  FIS: /\bFIS\b/i,
};

const PRIORITIES_BY_AIRSPACE_TYPE: Readonly<
  Record<number, OperationalFrequencyRole[]>
> = {
  4: ["TWR", "APP", "INFO"], // CTR
  7: ["APP", "RADAR", "CONTROL"], // TMA
  13: ["AFIS", "INFO"], // ATZ
  26: ["CONTROL", "APP"], // CTA
};

const GENERIC_LOCALITY_WORDS = new Set([
  "AFIS",
  "APP",
  "APPROACH",
  "ATZ",
  "CONTROL",
  "CTR",
  "FIS",
  "INFO",
  "INFORMATION",
  "RADAR",
  "REGION",
  "SECTOR",
  "SECTEUR",
  "SERVICE",
  "SIV",
  "TMA",
  "TWR",
  "ZONE",
]);

function normalizeWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(
      (word) =>
        word.length >= 3 &&
        !GENERIC_LOCALITY_WORDS.has(word),
    );
}

function hasConfirmedLocality(
  airspaceName: string,
  frequencyName: string | undefined,
): boolean {
  if (!frequencyName) return false;
  const airspaceWords = new Set(normalizeWords(airspaceName));
  return normalizeWords(frequencyName).some((word) => airspaceWords.has(word));
}

function getRole(
  frequency: OpenAipFrequency,
): OperationalFrequencyRole | null {
  const name = frequency.name ?? "";
  return (
    (Object.entries(ROLE_PATTERN).find(([, pattern]) =>
      pattern.test(name),
    )?.[0] as OperationalFrequencyRole | undefined) ?? null
  );
}

function selectForRole(
  frequencies: OpenAipFrequency[],
  role: OperationalFrequencyRole,
): OpenAipFrequency | null {
  const matches = frequencies.filter(
    (frequency) => getRole(frequency) === role,
  );
  if (matches.length === 1) return matches[0];

  const primaryMatches = matches.filter(
    (frequency) => frequency.primary === true,
  );
  return primaryMatches.length === 1 ? primaryMatches[0] : null;
}

function unavailable(
  reason: OperationalFrequencyContext["reason"],
): OperationalFrequencyContext {
  return {
    status: "UNAVAILABLE",
    value: null,
    stationName: null,
    role: null,
    sourceAirspaceId: null,
    source: null,
    reason,
  };
}

function available(
  airspace: AirspaceGeoJsonProperties,
  frequency: OpenAipFrequency,
  role: OperationalFrequencyRole | null,
  reason: OperationalFrequencyContext["reason"],
): OperationalFrequencyContext {
  return {
    status: "AVAILABLE",
    value: frequency.value,
    stationName: frequency.name?.trim() || null,
    role,
    sourceAirspaceId: airspace.airspaceId,
    source: "OPENAIP",
    reason,
  };
}

export function selectOperationalFrequency(
  flightContext: FlightContext,
): OperationalFrequencyContext {
  const current = flightContext.airspace.current;
  if (!current) return unavailable("NO_CURRENT_AIRSPACE");

  const airspace = current.airspace;
  const frequencies = airspace.frequencies.filter(
    (frequency) => frequency.value.trim() !== "",
  );
  const rolePriorities = PRIORITIES_BY_AIRSPACE_TYPE[airspace.type];

  if (rolePriorities) {
    for (const role of rolePriorities) {
      const frequency = selectForRole(frequencies, role);
      if (frequency) {
        return available(airspace, frequency, role, "OPERATIONAL_ROLE");
      }
    }

    if (airspace.type === 4 && frequencies.length === 1) {
      return available(
        airspace,
        frequencies[0],
        getRole(frequencies[0]),
        "UNIQUE_OFFICIAL_FREQUENCY",
      );
    }

    return unavailable("AMBIGUOUS_FREQUENCIES");
  }

  if (airspace.type === 33) {
    const localFrequencies = frequencies.filter((frequency) =>
      hasConfirmedLocality(airspace.name, frequency.name),
    );
    for (const role of ["FIS", "INFO"] as const) {
      const frequency = selectForRole(localFrequencies, role);
      if (frequency) {
        return available(airspace, frequency, role, "OPERATIONAL_ROLE");
      }
    }
    return unavailable("FIS_LOCALITY_UNCONFIRMED");
  }

  return unavailable("UNSUPPORTED_AIRSPACE_TYPE");
}

export function getAirspaceFrequencyPresentations(
  airspace: AirspaceGeoJsonProperties,
  operationalFrequency: OperationalFrequencyContext | null,
): AirspaceFrequencyPresentation[] {
  return airspace.frequencies
    .filter((frequency) => frequency.value.trim() !== "")
    .map((frequency) => ({
      name: frequency.name?.trim() || null,
      value: frequency.value,
      isOperational:
        operationalFrequency?.status === "AVAILABLE" &&
        operationalFrequency.sourceAirspaceId === airspace.airspaceId &&
        operationalFrequency.value === frequency.value,
    }))
    .sort(
      (left, right) =>
        Number(right.isOperational) - Number(left.isOperational),
    );
}
