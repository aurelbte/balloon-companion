import type { MapOptions } from "maplibre-gl";

/** Configuration commune : carte plane, orientation libre, inclinaison impossible. */
export const TWO_DIMENSIONAL_MAP_OPTIONS = {
  pitch: 0,
  bearing: 0,
  minPitch: 0,
  maxPitch: 0,
  pitchWithRotate: false,
  touchPitch: false,
  touchZoomRotate: true,
  dragRotate: true,
} satisfies Partial<MapOptions>;

export const REFERENCE_ORIENTATION = {
  bearing: 0,
  pitch: 0,
} as const;
