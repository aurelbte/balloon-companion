import {
  normalizeOpenAipAltitudeLimit,
} from "./airspaceAltitude.ts";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
} from "./openaip.ts";

export type AirspaceVisualCategory =
  | "INFORMATION_SERVICE"
  | "UPPER_AIRSPACE"
  | "CONTROLLED_TERMINAL"
  | "CONTROLLED_LOCAL"
  | "RESTRICTED"
  | "UNKNOWN";

export type AirspaceVerticalRelevance = "NORMAL" | "ABOVE_FAR" | "UNKNOWN";
export type AirspaceZoomContext = "NATIONAL" | "REGIONAL" | "LOCAL";

export interface AirspaceMapContext {
  currentAltitudeMeters: number | null;
  verticalAccuracyMeters?: number | null;
}

export interface AirspaceMapStyle {
  visualCategory: AirspaceVisualCategory;
  verticalRelevance: AirspaceVerticalRelevance;
  color: string;
  fillOpacity: number;
  lineOpacity: number;
  lineWidth: number;
  minZoom: number;
  maxZoom?: number;
  visible: boolean;
  displayPriority: number;
}

export interface AirspaceMapProperties extends AirspaceGeoJsonProperties {
  visualCategory: AirspaceVisualCategory;
  verticalRelevance: AirspaceVerticalRelevance;
  displayPriority: number;
  displayName: string;
  labelPriority: number;
  labelZoomRange: [number, number | null];
}

export type StyledAirspaceFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  AirspaceMapProperties
>;

export const AIRSPACE_MAP_PALETTE = {
  RESTRICTED: "#dc2626",
  CONTROLLED_LOCAL: "#2563eb",
  CONTROLLED_TERMINAL: "#38bdf8",
  INFORMATION_SERVICE: "#16a34a",
  UPPER_AIRSPACE: "#64748b",
  UNKNOWN: "#737373",
  SELECTED: "#f59e0b",
} as const satisfies Record<AirspaceVisualCategory | "SELECTED", string>;

export const AIRSPACE_RENDER_ORDER: readonly AirspaceVisualCategory[] = [
  "UNKNOWN",
  "INFORMATION_SERVICE",
  "UPPER_AIRSPACE",
  "CONTROLLED_TERMINAL",
  "CONTROLLED_LOCAL",
  "RESTRICTED",
];

const STYLE_BY_CATEGORY: Readonly<
  Record<
    AirspaceVisualCategory,
    Omit<
      AirspaceMapStyle,
      "visualCategory" | "verticalRelevance" | "visible"
    >
  >
> = {
  INFORMATION_SERVICE: {
    color: AIRSPACE_MAP_PALETTE.INFORMATION_SERVICE,
    fillOpacity: 0.04,
    lineOpacity: 0.8,
    lineWidth: 1.4,
    minZoom: 0,
    displayPriority: 10,
  },
  UPPER_AIRSPACE: {
    color: AIRSPACE_MAP_PALETTE.UPPER_AIRSPACE,
    fillOpacity: 0,
    lineOpacity: 0.4,
    lineWidth: 0.8,
    minZoom: 0,
    maxZoom: 9,
    displayPriority: 20,
  },
  CONTROLLED_TERMINAL: {
    color: AIRSPACE_MAP_PALETTE.CONTROLLED_TERMINAL,
    fillOpacity: 0.06,
    lineOpacity: 0.86,
    lineWidth: 1.6,
    minZoom: 6.5,
    displayPriority: 30,
  },
  CONTROLLED_LOCAL: {
    color: AIRSPACE_MAP_PALETTE.CONTROLLED_LOCAL,
    fillOpacity: 0.1,
    lineOpacity: 0.95,
    lineWidth: 2,
    minZoom: 8,
    displayPriority: 40,
  },
  RESTRICTED: {
    color: AIRSPACE_MAP_PALETTE.RESTRICTED,
    fillOpacity: 0.12,
    lineOpacity: 0.95,
    lineWidth: 2,
    minZoom: 6.5,
    displayPriority: 50,
  },
  UNKNOWN: {
    color: AIRSPACE_MAP_PALETTE.UNKNOWN,
    fillOpacity: 0,
    lineOpacity: 0.5,
    lineWidth: 0.8,
    minZoom: 9,
    displayPriority: 5,
  },
};

const RESTRICTED_TYPES = new Set([1, 2, 3]);
const CONTROLLED_LOCAL_TYPES = new Set([4, 13, 14, 23, 24, 36]);
const CONTROLLED_TERMINAL_TYPES = new Set([5, 6, 7, 26]);
const UPPER_AIRSPACE_TYPES = new Set([10, 11, 27, 34, 35]);
const INFORMATION_SERVICE_TYPES = new Set([33]);
const INFORMATION_SERVICE_NAME = /\b(?:SIV|FIS)\b/i;
const UPPER_AIRSPACE_NAME = /\b(?:LTA|FIR|UIR)\b/i;
const CLEARLY_ABOVE_MARGIN_METERS = 600;

/**
 * Correspondance documentée des codes OpenAIP utilisés par la carte :
 * 1 Restricted, 2 Danger, 3 Prohibited;
 * 4 CTR, 13 ATZ, 14 MATZ, 23 TIZ, 24 TIA, 36 MCTR;
 * 5 TMZ, 6 RMZ, 7 TMA, 26 CTA;
 * 33 FIS Sector;
 * 10 FIR, 11 UIR, 27 ACC Sector, 34 LTA, 35 UTA.
 * Tout autre code reste UNKNOWN. Un nom SIV/FIS n'est accepté comme service
 * d'information que s'il ne correspond pas à un espace supérieur explicite.
 */
export function getAirspaceVisualCategory(
  airspace: Pick<AirspaceGeoJsonProperties, "type" | "name">,
): AirspaceVisualCategory {
  if (RESTRICTED_TYPES.has(airspace.type)) return "RESTRICTED";
  if (CONTROLLED_LOCAL_TYPES.has(airspace.type)) return "CONTROLLED_LOCAL";
  if (CONTROLLED_TERMINAL_TYPES.has(airspace.type)) {
    return "CONTROLLED_TERMINAL";
  }
  if (UPPER_AIRSPACE_TYPES.has(airspace.type)) return "UPPER_AIRSPACE";
  if (INFORMATION_SERVICE_TYPES.has(airspace.type)) {
    return "INFORMATION_SERVICE";
  }
  if (
    INFORMATION_SERVICE_NAME.test(airspace.name) &&
    !UPPER_AIRSPACE_NAME.test(airspace.name)
  ) {
    return "INFORMATION_SERVICE";
  }
  return "UNKNOWN";
}

export function getAirspaceZoomContext(zoom: number): AirspaceZoomContext {
  if (zoom < 6.5) return "NATIONAL";
  if (zoom < 9) return "REGIONAL";
  return "LOCAL";
}

export function isAirspaceCategoryVisibleAtZoom(
  category: AirspaceVisualCategory,
  zoom: number,
): boolean {
  const style = STYLE_BY_CATEGORY[category];
  return (
    zoom >= style.minZoom &&
    (style.maxZoom === undefined || zoom < style.maxZoom)
  );
}

export function getAirspaceVerticalRelevance(
  airspace: Pick<AirspaceGeoJsonProperties, "lowerLimit">,
  context: AirspaceMapContext,
): AirspaceVerticalRelevance {
  const altitude = context.currentAltitudeMeters;
  if (altitude === null || !Number.isFinite(altitude)) return "UNKNOWN";

  const floor = normalizeOpenAipAltitudeLimit(airspace.lowerLimit);
  if (floor.metersAMSL === null) return "UNKNOWN";

  const accuracy =
    context.verticalAccuracyMeters !== null &&
    context.verticalAccuracyMeters !== undefined &&
    Number.isFinite(context.verticalAccuracyMeters)
      ? Math.abs(context.verticalAccuracyMeters)
      : 0;

  return floor.metersAMSL - (altitude + accuracy) >=
    CLEARLY_ABOVE_MARGIN_METERS
    ? "ABOVE_FAR"
    : "NORMAL";
}

export function getAirspaceMapStyle(
  airspace: Pick<AirspaceGeoJsonProperties, "type" | "name" | "lowerLimit">,
  zoom: number,
  context: AirspaceMapContext,
): AirspaceMapStyle {
  const visualCategory = getAirspaceVisualCategory(airspace);
  const verticalRelevance = getAirspaceVerticalRelevance(airspace, context);
  const base = STYLE_BY_CATEGORY[visualCategory];
  const visible = isAirspaceCategoryVisibleAtZoom(visualCategory, zoom);

  return {
    ...base,
    visualCategory,
    verticalRelevance,
    visible,
    fillOpacity:
      verticalRelevance === "ABOVE_FAR" ? 0 : base.fillOpacity,
    lineOpacity:
      verticalRelevance === "ABOVE_FAR"
        ? Math.min(base.lineOpacity, 0.42)
        : base.lineOpacity,
    lineWidth:
      verticalRelevance === "ABOVE_FAR"
        ? Math.max(0.7, base.lineWidth * 0.75)
        : base.lineWidth,
  };
}

export function prepareAirspacesForMap(
  airspaces: AirspaceFeatureCollection,
  context: AirspaceMapContext,
): StyledAirspaceFeatureCollection {
  return {
    type: "FeatureCollection",
    features: airspaces.features.map((feature) => {
      const style = getAirspaceMapStyle(feature.properties, 9, context);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          visualCategory: style.visualCategory,
          verticalRelevance: style.verticalRelevance,
          displayPriority: style.displayPriority,
          displayName: feature.properties.name,
          labelPriority:
            style.visualCategory === "INFORMATION_SERVICE"
              ? 100
              : style.displayPriority,
          labelZoomRange: [style.minZoom, style.maxZoom ?? null],
        },
      };
    }),
  };
}

export function getAirspaceCategoryStyle(
  category: AirspaceVisualCategory,
): Readonly<(typeof STYLE_BY_CATEGORY)[AirspaceVisualCategory]> {
  return STYLE_BY_CATEGORY[category];
}
