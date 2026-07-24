import type {
  FlightLayerSettings,
  ProjectionPoint,
} from "../types/flight";

export const FLIGHT_TRACK_STYLE = {
  haloWidth: 8,
  lineWidth: 5.5,
} as const;

export const GPS_PROJECTION_STYLE = {
  haloWidth: 9,
  lineWidth: 5.5,
} as const;

export const CURRENT_POSITION_MARKER_STYLE = {
  containerSize: 66,
  haloSize: 64,
  arrowSize: 40,
  strokeWidth: 2.1,
} as const;

export const FLIGHT_BOTTOM_LAYOUT = {
  navigationTopAndContentHeight: 60,
  gapAboveNavigation: 10,
  instrumentsHeight: 112,
  instrumentsBottomOffset: 70,
  controlsBottomOffset: 194,
  popoverBottomClearance: 194,
} as const;

export const MAP_OPTIONS_POPOVER_LAYOUT = {
  right: 76,
  topSafeClearance: 54,
} as const;

export const MAP_USEFUL_AREA = {
  top: 72,
  bottom: 198,
  left: 24,
  right: 84,
  anchorFromTop: 0.65,
} as const;

export interface MapViewportSize {
  width: number;
  height: number;
}

export interface MapCameraInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type FollowPositionAction =
  | "GPS_UPDATE"
  | "ZOOM"
  | "MANUAL_DRAG"
  | "RECENTER"
  | "FIT_PROJECTION";

export type MapOptionsAction =
  | "TOGGLE"
  | "MAP_PRESS"
  | "OUTSIDE_PRESS"
  | "ESCAPE";

/**
 * Place la position à 65 % de la hauteur réellement exploitable, soit environ
 * 35 % au-dessus du bas utile, sans dépendre de coordonnées géographiques.
 */
export function getFollowCameraOffset({
  width,
  height,
}: MapViewportSize): [number, number] {
  const usableTop = Math.min(MAP_USEFUL_AREA.top, height * 0.2);
  const usableBottom = Math.max(
    usableTop + 1,
    height - Math.min(MAP_USEFUL_AREA.bottom, height * 0.38),
  );
  const anchorY =
    usableTop +
    (usableBottom - usableTop) * MAP_USEFUL_AREA.anchorFromTop;

  return [Math.round(width / 2 - width / 2), Math.round(anchorY - height / 2)];
}

export function getMapCameraInsets({
  width,
  height,
}: MapViewportSize): MapCameraInsets {
  return {
    top: Math.min(MAP_USEFUL_AREA.top, Math.round(height * 0.2)),
    bottom: Math.min(MAP_USEFUL_AREA.bottom, Math.round(height * 0.38)),
    left: Math.min(MAP_USEFUL_AREA.left, Math.round(width * 0.08)),
    right: Math.min(MAP_USEFUL_AREA.right, Math.round(width * 0.24)),
  };
}

export function shouldSuspendFollowForDrag({
  isZooming,
  touchCount,
}: {
  isZooming: boolean;
  touchCount: number;
}): boolean {
  return !isZooming && touchCount < 2;
}

export function getFollowPositionAfterAction(
  current: boolean,
  action: FollowPositionAction,
): boolean {
  if (action === "MANUAL_DRAG") return false;
  if (action === "RECENTER" || action === "FIT_PROJECTION") return true;
  return current;
}

export function shouldApplyInitialCenter({
  hasValidPosition,
  alreadyCentered,
}: {
  hasValidPosition: boolean;
  alreadyCentered: boolean;
}): boolean {
  return hasValidPosition && !alreadyCentered;
}

export function getMapOptionsOpenAfterAction(
  current: boolean,
  action: MapOptionsAction,
): boolean {
  return action === "TOGGLE" ? !current : false;
}

export function toggleMapLayerSetting(
  settings: FlightLayerSettings,
  key: keyof FlightLayerSettings,
): FlightLayerSettings {
  return {
    ...settings,
    [key]: !settings[key],
  };
}

export function getPositionMarkerRotation(
  heading: number | null,
): number | null {
  if (heading === null || !Number.isFinite(heading)) return null;
  return ((heading % 360) + 360) % 360;
}

export function getPositionMarkerHaloOpacity(
  accuracy: number | null,
): number {
  if (accuracy === null || !Number.isFinite(accuracy)) return 0.16;
  return Math.min(0.26, Math.max(0.12, 0.12 + accuracy / 800));
}

export function getVisibleProjectionMinutes(
  zoom: number,
  projection: ProjectionPoint[],
): number[] {
  const available = new Set(
    projection
      .filter(
        (point) =>
          Number.isFinite(point.minutes) &&
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude),
      )
      .map((point) => point.minutes),
  );

  const wanted =
    zoom >= 10 ? [5, 10, 20, 30, 60] : zoom >= 8 ? [5, 10, 20, 30] : [5, 10, 20];

  return wanted.filter((minutes) => available.has(minutes));
}

export function isMapDisplayCustomized({
  baseMap,
  airspaces,
  highContrast,
}: {
  baseMap: "plan" | "satellite";
  airspaces: boolean;
  highContrast: boolean;
}): boolean {
  return baseMap === "satellite" || airspaces || highContrast;
}
