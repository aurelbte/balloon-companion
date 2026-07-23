import type { OpenAipAltitudeLimit } from "./openaip";

export type AltitudeReference = "AMSL" | "AGL" | "SFC" | "FL" | "UNKNOWN";

export interface NormalizedAltitudeLimit {
  value: number | null;
  unit: "FT" | "M" | "FL" | null;
  reference: AltitudeReference;
  metersAMSL: number | null;
  displayLabel: string;
}

export type VerticalAirspaceState = "BELOW" | "INSIDE" | "ABOVE" | "UNKNOWN";

export interface AirspaceVerticalContext {
  state: VerticalAirspaceState;
  currentAltitudeMeters: number | null;
  verticalAccuracyMeters: number | null;
  distanceToFloorMeters: number | null;
  distanceToCeilingMeters: number | null;
  isFloorComparable: boolean;
  isCeilingComparable: boolean;
}

const FEET_TO_METERS = 0.3048;

const UNKNOWN_LIMIT: NormalizedAltitudeLimit = {
  value: null,
  unit: null,
  reference: "UNKNOWN",
  metersAMSL: null,
  displayLabel: "—",
};

export function normalizeOpenAipAltitudeLimit(
  limit: OpenAipAltitudeLimit | null | undefined
): NormalizedAltitudeLimit {
  if (!limit || !Number.isFinite(limit.value)) return { ...UNKNOWN_LIMIT };

  if (limit.unit === 6) {
    return {
      value: limit.value,
      unit: "FL",
      reference: "FL",
      metersAMSL: null,
      displayLabel: `FL ${limit.value}`,
    };
  }

  const unit = limit.unit === 0 ? "M" : limit.unit === 1 ? "FT" : null;
  if (!unit) return { ...UNKNOWN_LIMIT, value: limit.value };

  if (limit.referenceDatum === 0) {
    if (limit.value === 0) {
      return {
        value: 0,
        unit,
        reference: "SFC",
        metersAMSL: null,
        displayLabel: "SFC",
      };
    }

    return {
      value: limit.value,
      unit,
      reference: "AGL",
      metersAMSL: null,
      displayLabel: `${limit.value} ${unit === "FT" ? "ft" : "m"} AGL`,
    };
  }

  if (limit.referenceDatum === 1) {
    return {
      value: limit.value,
      unit,
      reference: "AMSL",
      metersAMSL: unit === "FT" ? limit.value * FEET_TO_METERS : limit.value,
      displayLabel: `${limit.value} ${unit === "FT" ? "ft" : "m"} AMSL`,
    };
  }

  return {
    value: limit.value,
    unit,
    reference: "UNKNOWN",
    metersAMSL: null,
    displayLabel: `${limit.value} ${unit === "FT" ? "ft" : "m"} STD`,
  };
}

export function calculateAirspaceVerticalContext(
  lowerLimit: NormalizedAltitudeLimit,
  upperLimit: NormalizedAltitudeLimit,
  currentAltitudeMeters: number | null,
  verticalAccuracyMeters: number | null = null
): AirspaceVerticalContext {
  const altitude =
    currentAltitudeMeters !== null && Number.isFinite(currentAltitudeMeters)
      ? currentAltitudeMeters
      : null;
  const accuracy =
    verticalAccuracyMeters !== null && Number.isFinite(verticalAccuracyMeters)
      ? Math.abs(verticalAccuracyMeters)
      : null;
  const floorMeters = lowerLimit.metersAMSL;
  const ceilingMeters = upperLimit.metersAMSL;
  const isSurfaceFloor = lowerLimit.reference === "SFC";
  const isFloorComparable = floorMeters !== null || isSurfaceFloor;
  const isCeilingComparable = ceilingMeters !== null;

  const baseContext = {
    currentAltitudeMeters: altitude,
    verticalAccuracyMeters: accuracy,
    distanceToFloorMeters:
      altitude !== null && floorMeters !== null
        ? Math.abs(altitude - floorMeters)
        : null,
    distanceToCeilingMeters:
      altitude !== null && ceilingMeters !== null
        ? Math.abs(ceilingMeters - altitude)
        : null,
    isFloorComparable,
    isCeilingComparable,
  };

  if (altitude === null) return { state: "UNKNOWN", ...baseContext };

  if (floorMeters !== null && altitude < floorMeters) {
    return { state: "BELOW", ...baseContext };
  }

  if (ceilingMeters !== null && altitude > ceilingMeters) {
    return { state: "ABOVE", ...baseContext };
  }

  if (
    isFloorComparable &&
    isCeilingComparable &&
    (isSurfaceFloor || (floorMeters !== null && altitude >= floorMeters)) &&
    ceilingMeters !== null &&
    altitude <= ceilingMeters
  ) {
    return { state: "INSIDE", ...baseContext };
  }

  return { state: "UNKNOWN", ...baseContext };
}
