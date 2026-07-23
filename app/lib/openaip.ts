import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export interface OpenAipAltitudeLimit {
  value: number;
  unit: number;
  referenceDatum: number;
}

export interface OpenAipFrequency {
  value: string;
  unit: number;
  name?: string;
  primary?: boolean;
  remarks?: string;
}

export type OpenAipGeometry =
  | {
      type: "Polygon";
      coordinates: number[][][];
    }
  | {
      type: "MultiPolygon";
      coordinates: number[][][][];
    };

export interface OpenAipAirspace {
  _id: string;
  name: string;
  type: number;
  icaoClass?: number;
  geometry: OpenAipGeometry;
  upperLimit?: OpenAipAltitudeLimit;
  lowerLimit?: OpenAipAltitudeLimit;
  upperLimitMax?: OpenAipAltitudeLimit;
  lowerLimitMin?: OpenAipAltitudeLimit;
  frequencies?: OpenAipFrequency[];
  remarks?: string;
  country?: string;
  activity?: number;
  onDemand?: boolean;
  onRequest?: boolean;
  byNotam?: boolean;
  activeFrom?: string;
  activeUntil?: string;
}

export interface OpenAipAirspaceResponse {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  nextPage?: number;
  items: OpenAipAirspace[];
}

export interface AirspaceGeoJsonProperties {
  id: string;
  airspaceId: string;
  airspaceCompositeKey: string;
  name: string;
  type: number;
  typeLabel: string;
  icaoClass: number | null;
  icaoClassLabel: string;
  lowerLimit: OpenAipAltitudeLimit | null;
  upperLimit: OpenAipAltitudeLimit | null;
  lowerLimitMin: OpenAipAltitudeLimit | null;
  upperLimitMax: OpenAipAltitudeLimit | null;
  frequencies: OpenAipFrequency[];
  remarks: string | null;
  country: string | null;
  activity: number | null;
  onDemand: boolean | null;
  onRequest: boolean | null;
  byNotam: boolean | null;
  activeFrom: string | null;
  activeUntil: string | null;
}

export type AirspaceGeometry = Polygon | MultiPolygon;
export type AirspaceFeatureCollection = FeatureCollection<
  AirspaceGeometry,
  AirspaceGeoJsonProperties
>;

interface AirspaceCompositeKeyInput {
  name: string;
  type: number;
  lowerLimit?: OpenAipAltitudeLimit | null;
  upperLimit?: OpenAipAltitudeLimit | null;
}

function serializeAltitudeLimit(limit?: OpenAipAltitudeLimit | null): string {
  if (!limit) {
    return "";
  }

  return `${limit.value}:${limit.unit}:${limit.referenceDatum}`;
}

export function createAirspaceCompositeKey(
  airspace: AirspaceCompositeKeyInput,
): string {
  return [
    airspace.name.trim(),
    String(airspace.type),
    serializeAltitudeLimit(airspace.lowerLimit),
    serializeAltitudeLimit(airspace.upperLimit),
  ].join("|");
}

export const OPENAIP_AIRSPACE_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "Other",
  1: "Restricted",
  2: "Danger",
  3: "Prohibited",
  4: "CTR",
  5: "TMZ",
  6: "RMZ",
  7: "TMA",
  8: "TRA",
  9: "TSA",
  10: "FIR",
  11: "UIR",
  12: "ADIZ",
  13: "ATZ",
  14: "MATZ",
  15: "Airway",
  16: "MTR",
  17: "Alert Area",
  18: "Warning Area",
  19: "Protected Area",
  20: "HTZ",
  21: "Gliding Sector",
  22: "TRP",
  23: "TIZ",
  24: "TIA",
  25: "MTA",
  26: "CTA",
  27: "ACC Sector",
  28: "Aerial Sporting or Recreational Activity",
  29: "Low Altitude Overflight Restriction",
  30: "MRT",
  31: "TFR",
  32: "VFR Sector",
  33: "FIS Sector",
  34: "LTA",
  35: "UTA",
  36: "MCTR",
};

export const OPENAIP_ICAO_CLASS_LABELS: Readonly<Record<number, string>> = {
  0: "A",
  1: "B",
  2: "C",
  3: "D",
  4: "E",
  5: "F",
  6: "G",
  8: "Unclassified / SUA",
};

export function getOpenAipAirspaceTypeLabel(type: number): string {
  return OPENAIP_AIRSPACE_TYPE_LABELS[type] ?? "Type inconnu";
}

export function getOpenAipIcaoClassLabel(icaoClass: number | undefined): string {
  if (icaoClass === undefined) return "Classe inconnue";
  return OPENAIP_ICAO_CLASS_LABELS[icaoClass] ?? "Classe inconnue";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidGeometry(value: unknown): value is OpenAipGeometry {
  if (typeof value !== "object" || value === null) return false;

  const geometry = value as Partial<OpenAipGeometry>;
  return (
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon") &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length > 0
  );
}

function isValidAirspace(value: unknown): value is OpenAipAirspace {
  if (typeof value !== "object" || value === null) return false;

  const airspace = value as Partial<OpenAipAirspace>;
  return (
    isNonEmptyString(airspace._id) &&
    isNonEmptyString(airspace.name) &&
    isValidGeometry(airspace.geometry)
  );
}

export function openAipAirspacesToGeoJson(
  response: OpenAipAirspaceResponse
): AirspaceFeatureCollection {
  const items: unknown[] = Array.isArray(response.items) ? response.items : [];

  return {
    type: "FeatureCollection",
    features: items.filter(isValidAirspace).map((airspace) => ({
      type: "Feature" as const,
      id: airspace._id,
      geometry: airspace.geometry,
      properties: {
        id: airspace._id,
        airspaceId: airspace._id,
        airspaceCompositeKey: createAirspaceCompositeKey(airspace),
        name: airspace.name,
        type: airspace.type,
        typeLabel: getOpenAipAirspaceTypeLabel(airspace.type),
        icaoClass: airspace.icaoClass ?? null,
        icaoClassLabel: getOpenAipIcaoClassLabel(airspace.icaoClass),
        lowerLimit: airspace.lowerLimit ?? null,
        upperLimit: airspace.upperLimit ?? null,
        lowerLimitMin: airspace.lowerLimitMin ?? null,
        upperLimitMax: airspace.upperLimitMax ?? null,
        frequencies: airspace.frequencies ?? [],
        remarks: airspace.remarks ?? null,
        country: airspace.country ?? null,
        activity: airspace.activity ?? null,
        onDemand: airspace.onDemand ?? null,
        onRequest: airspace.onRequest ?? null,
        byNotam: airspace.byNotam ?? null,
        activeFrom: airspace.activeFrom ?? null,
        activeUntil: airspace.activeUntil ?? null,
      },
    })),
  };
}

export function mergeAirspaceFeatureCollections(
  current: AirspaceFeatureCollection,
  incoming: AirspaceFeatureCollection,
): AirspaceFeatureCollection {
  const featuresById = new Map(
    current.features.map((feature) => [
      feature.properties.airspaceId,
      feature,
    ]),
  );

  for (const feature of incoming.features) {
    featuresById.set(feature.properties.airspaceId, feature);
  }

  return {
    type: "FeatureCollection",
    features: [...featuresById.values()],
  };
}
