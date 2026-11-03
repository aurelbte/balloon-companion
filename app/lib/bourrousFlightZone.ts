import type maplibregl from "maplibre-gl";

export const BOURROUS_ZONE_URL = "/geo/zone-vol-bourrous.geojson";
const SOURCE = "bourrous-flight-zone";

/** Local geographic overlay, independent of aeronautical visibility and selection. */
export function addBourrousFlightZone(map: maplibregl.Map) {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: "geojson", data: BOURROUS_ZONE_URL });
  map.addLayer({
    id: "bourrous-flight-zone-fill",
    type: "fill",
    source: SOURCE,
    layout: { visibility: "visible" },
    paint: { "fill-color": "#a855f7", "fill-opacity": 0.2 },
  });
  map.addLayer({
    id: "bourrous-flight-zone-outline",
    type: "line",
    source: SOURCE,
    layout: { visibility: "visible", "line-join": "round" },
    paint: { "line-color": "#c084fc", "line-width": 4, "line-opacity": 1 },
  });

}
