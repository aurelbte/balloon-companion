import type { Map, RasterSourceSpecification } from "maplibre-gl";

export const LAUNCH_PLAN_LAYER = "plan-base";
export const LAUNCH_SATELLITE_LAYER = "launch-satellite";
export const LAUNCH_SATELLITE_SOURCE = "launch-satellite-tiles";
export type LaunchPointBaseMap = "plan" | "satellite";

/** Reuse the existing journal/flight MapTiler Hybrid service and public key. */
export function launchSatelliteSource(key: string): RasterSourceSpecification | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  return {
    type: "raster",
    tiles: [`https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}@2x.jpg?key=${encodeURIComponent(trimmed)}`],
    tileSize: 256,
    maxzoom: 22,
    attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
  };
}

/** Visibility only: never recreate the map, move the marker, or write a favorite. */
export function setLaunchPointBaseMap(map: Pick<Map, "getLayer" | "setLayoutProperty">, requested: LaunchPointBaseMap): LaunchPointBaseMap {
  const satellite = Boolean(map.getLayer(LAUNCH_SATELLITE_LAYER));
  const selected = requested === "satellite" && satellite ? "satellite" : "plan";
  map.setLayoutProperty(LAUNCH_PLAN_LAYER, "visibility", selected === "plan" ? "visible" : "none");
  if (satellite) map.setLayoutProperty(LAUNCH_SATELLITE_LAYER, "visibility", selected === "satellite" ? "visible" : "none");
  return selected;
}
