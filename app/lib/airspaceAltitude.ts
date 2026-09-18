import type { OpenAipAltitudeLimit } from "./openaip";

export type AltitudeReference = "AMSL" | "AGL" | "SFC" | "FL" | "UNKNOWN";
export type VerticalComparability = "COMPARABLE" | "ESTIMATED" | "NOT_COMPARABLE" | "UNKNOWN";

export interface NormalizedAltitudeLimit {
  raw: OpenAipAltitudeLimit | null;
  value: number | null;
  unit: "FT" | "M" | "FL" | null;
  reference: AltitudeReference;
  /** Conversion of the published limit only; does not qualify pilot altitude. */
  metersAMSL: number | null;
  comparability: VerticalComparability;
  displayLabel: string;
}

export type VerticalAirspaceState = "BELOW" | "INSIDE" | "ABOVE" | "UNKNOWN";
export interface AirspaceVerticalContext {
  state: VerticalAirspaceState;
  comparability: VerticalComparability;
  currentAltitudeMeters: number | null;
  verticalAccuracyMeters: number | null;
  distanceToFloorMeters: number | null;
  distanceToCeilingMeters: number | null;
  isFloorComparable: boolean;
  isCeilingComparable: boolean;
}

export function normalizeOpenAipAltitudeLimit(limit: OpenAipAltitudeLimit | null | undefined): NormalizedAltitudeLimit {
  const unit = limit?.unit === 0 ? "M" : limit?.unit === 1 ? "FT" : limit?.unit === 6 ? "FL" : null;
  const base: NormalizedAltitudeLimit = {
    raw: limit ? { ...limit } : null,
    value: limit && Number.isFinite(limit.value) ? limit.value : null,
    unit, reference: "UNKNOWN", metersAMSL: null, comparability: "UNKNOWN",
    displayLabel: limit ? `${String(limit.value)} ${unit === "FT" ? "ft" : unit === "M" ? "m" : unit ?? `unité inconnue (${String(limit.unit)})`} · référence verticale inconnue (${String(limit.referenceDatum)})` : "Limite verticale inconnue",
  };
  if (!limit || !Number.isFinite(limit.value)) return base;
  if (unit === "FL") return { ...base, reference: "FL", comparability: "NOT_COMPARABLE", displayLabel: `FL ${String(limit.value).padStart(3, "0")}` };
  if (!unit) return base;
  const published = `${limit.value} ${unit === "FT" ? "ft" : "m"}`;
  if (limit.referenceDatum === 0) return { ...base, reference: limit.value === 0 ? "SFC" : "AGL", comparability: "NOT_COMPARABLE", displayLabel: limit.value === 0 ? "SFC" : `${published} AGL` };
  if (limit.referenceDatum === 1) {
    const meters = unit === "FT" ? limit.value * 0.3048 : limit.value;
    if (!Number.isFinite(meters)) return base;
    return { ...base, reference: "AMSL", metersAMSL: meters, comparability: "COMPARABLE", displayLabel: `${published} AMSL` };
  }
  return base;
}

/** GPS callers have no demonstrated AMSL datum and must retain UNKNOWN. */
export function calculateAirspaceVerticalContext(
  lowerLimit: NormalizedAltitudeLimit,
  upperLimit: NormalizedAltitudeLimit,
  currentAltitudeMeters: number | null,
  verticalAccuracyMeters: number | null = null,
  altitudeReference: "AMSL" | "UNKNOWN" = "UNKNOWN",
): AirspaceVerticalContext {
  const altitude = currentAltitudeMeters !== null && Number.isFinite(currentAltitudeMeters) ? currentAltitudeMeters : null;
  const accuracy = verticalAccuracyMeters !== null && Number.isFinite(verticalAccuracyMeters) && verticalAccuracyMeters >= 0 ? verticalAccuracyMeters : null;
  const compatible = altitudeReference === "AMSL" && altitude !== null && accuracy !== null && Number.isFinite(altitude - accuracy) && Number.isFinite(altitude + accuracy);
  const floor = lowerLimit.comparability === "COMPARABLE" && compatible ? lowerLimit.metersAMSL : null;
  const ceiling = upperLimit.comparability === "COMPARABLE" && compatible ? upperLimit.metersAMSL : null;
  const surface = lowerLimit.reference === "SFC";
  const base: AirspaceVerticalContext = {
    state: "UNKNOWN",
    comparability: lowerLimit.comparability === "UNKNOWN" || upperLimit.comparability === "UNKNOWN" ? "UNKNOWN" : floor !== null && ceiling !== null ? "COMPARABLE" : "NOT_COMPARABLE",
    currentAltitudeMeters: altitude, verticalAccuracyMeters: accuracy,
    distanceToFloorMeters: floor !== null ? Math.abs(altitude! - floor) : null,
    distanceToCeilingMeters: ceiling !== null ? Math.abs(ceiling - altitude!) : null,
    isFloorComparable: floor !== null, isCeilingComparable: ceiling !== null,
  };
  if (!compatible) return base;
  if (floor !== null && ceiling !== null && floor > ceiling) return { ...base, comparability: "UNKNOWN" };
  const low = altitude! - accuracy!, high = altitude! + accuracy!;
  if (floor !== null && high < floor) return { ...base, state: "BELOW" };
  if (ceiling !== null && low > ceiling) return { ...base, state: "ABOVE" };
  // SFC is only a potential-presence convention, never a measured floor.
  if (!surface && floor !== null && ceiling !== null && low > floor && high < ceiling) return { ...base, state: "INSIDE" };
  return base;
}

export function airspaceVerticalNotice(lower: OpenAipAltitudeLimit | null, upper: OpenAipAltitudeLimit | null): string {
  return [lower, upper].some(limit => normalizeOpenAipAltitudeLimit(limit).comparability === "UNKNOWN")
    ? "Référence verticale inconnue"
    : "Référence verticale non comparable à l’altitude actuelle";
}
