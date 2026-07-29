import type { ExpressionSpecification } from "maplibre-gl";

/**
 * Balloon Companion Cartography 1.0
 *
 * Presentation-only constants shared by every MapLibre view. Raw colors are
 * required here because MapLibre paint properties cannot resolve DOM CSS
 * custom properties inside its rendering worker.
 */
export const CARTOGRAPHY_PALETTE = {
  ink: "#06111f",
  inkSoft: "rgba(6, 17, 31, 0.72)",
  cloud: "#f3f7fb",
  flightTrack: "#f0a35b",
  launch: "#55c493",
  recovery: "#e87578",
  gpsProjection: "#58c99a",
  weatherProjection: "#6ba9df",
} as const;

function interpolateZoom(...stops: number[]): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops];
}

export const ANALYSIS_TRAJECTORY_STYLE = {
  haloColor: CARTOGRAPHY_PALETTE.ink,
  haloOpacity: 0.82,
  haloWidth: interpolateZoom(6, 5.5, 10, 7, 14, 8.5),
  lineOpacity: 0.92,
  lineWidth: interpolateZoom(6, 2.5, 10, 3.25, 14, 4),
} as const;

export const PLANNED_TRAJECTORY_STYLE = {
  haloColor: CARTOGRAPHY_PALETTE.ink,
  haloOpacity: 0.48,
  haloWidth: interpolateZoom(7, 3.5, 12, 5),
  lineOpacity: 0.7,
  lineWidth: interpolateZoom(7, 1.5, 12, 2.25),
} as const;

export const FLIGHT_TRACK_CARTOGRAPHY_STYLE = {
  haloColor: CARTOGRAPHY_PALETTE.ink,
  haloOpacity: 0.88,
  haloWidth: interpolateZoom(7, 7, 12, 9.5, 16, 11),
  lineColor: CARTOGRAPHY_PALETTE.flightTrack,
  lineOpacity: 0.98,
  lineWidth: interpolateZoom(7, 4.5, 12, 6, 16, 7),
} as const;

export const GPS_PROJECTION_CARTOGRAPHY_STYLE = {
  haloColor: CARTOGRAPHY_PALETTE.ink,
  haloOpacity: 0.84,
  haloWidth: interpolateZoom(7, 6.5, 12, 8.5, 16, 9.5),
  lineColor: CARTOGRAPHY_PALETTE.gpsProjection,
  lineOpacity: 0.94,
  lineWidth: interpolateZoom(7, 4, 12, 5.25, 16, 6),
} as const;

export const WEATHER_PROJECTION_CARTOGRAPHY_STYLE = {
  lineColor: CARTOGRAPHY_PALETTE.weatherProjection,
  lineOpacity: 0.66,
  lineWidth: interpolateZoom(7, 1.5, 12, 2.25),
  dasharray: [4, 4],
} as const;

export const CARTOGRAPHY_MARKER_STYLE = {
  launchRadius: interpolateZoom(7, 5, 12, 7, 16, 8),
  arrivalRadius: interpolateZoom(7, 5, 12, 7, 16, 8),
  projectionPointRadius: interpolateZoom(7, 3.5, 12, 5, 16, 6),
  haloStrokeWidth: 2,
  outerHaloWidth: 4,
} as const;

export const TIME_MARKER_STYLE = {
  textSize: interpolateZoom(7, 9, 11, 10, 14, 11),
  textColor: CARTOGRAPHY_PALETTE.ink,
  haloWidth: 3,
} as const;
