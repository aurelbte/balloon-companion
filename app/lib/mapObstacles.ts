import maplibregl from "maplibre-gl";
import { OBSTACLE_MIN_ZOOM } from "./obstacles.ts";
export const OBSTACLE_SOURCE = "bc-obstacles";
const LAYER = "bc-obstacle-points";
const popups = new WeakMap<maplibregl.Map, maplibregl.Popup>();
export function addObstacleLayer(map: maplibregl.Map, visible: boolean) {
  map.addSource(OBSTACLE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' });
  map.addLayer({ id: LAYER, type: "circle", source: OBSTACLE_SOURCE, minzoom: OBSTACLE_MIN_ZOOM, layout: { visibility: visible ? "visible" : "none" }, paint: {
    "circle-radius": 5, "circle-color": ["match", ["get", "kind"], "pylon", "#fbbf24", "wind", "#67e8f9", "#c4b5fd"], "circle-stroke-color": "#172033", "circle-stroke-width": 1.5,
  } });
}
export function clearObstacleInfo(map: maplibregl.Map) { popups.get(map)?.remove(); popups.delete(map); }
export function setObstaclesVisible(map: maplibregl.Map, visible: boolean) {
  if (map.getLayer(LAYER)) map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
  if (!visible) clearObstacleInfo(map);
}
/** Called inside existing click handlers; no new map/network listeners. */
export function showObstacleInfo(map: maplibregl.Map, point: { x: number; y: number }): boolean {
  clearObstacleInfo(map);
  if (!map.getLayer(LAYER) || map.getLayoutProperty(LAYER, "visibility") === "none" || map.getZoom() < OBSTACLE_MIN_ZOOM) return false;
  const features = map.queryRenderedFeatures([[point.x - 22, point.y - 22], [point.x + 22, point.y + 22]], { layers: [LAYER] });
  const feature = features.find(f => f.geometry.type === "Point");
  if (!feature || feature.geometry.type !== "Point") return false;
  const props = feature.properties;
  const title = ({ pylon: "Pylône électrique", mast: "Mât / antenne", wind: "Éolienne" } as Record<string, string>)[props.kind] ?? "Obstacle";
  const height = typeof props.heightM === "number" && Number.isFinite(props.heightM) ? `Hauteur : ${props.heightM} m` : "Hauteur inconnue";
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "250px", offset: 10 })
    .setLngLat(feature.geometry.coordinates as [number, number])
    .setText([title, props.name, height, "Source : OSM"].filter(Boolean).join(" · "))
    .addTo(map);
  const element = popup.getElement();
  element.style.color = "#0f172a";
  const close = element.querySelector<HTMLButtonElement>(".maplibregl-popup-close-button");
  if (close) Object.assign(close.style, { minWidth: "44px", minHeight: "44px", fontSize: "20px" });
  const content = element.querySelector<HTMLElement>(".maplibregl-popup-content");
  if (content) content.style.padding = "12px 44px 12px 12px";
  popups.set(map, popup);
  return true;
}
