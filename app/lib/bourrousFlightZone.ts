import maplibregl from "maplibre-gl";

export const BOURROUS_ZONE_URL = "/geo/zone-vol-bourrous.geojson";
const SOURCE = "bourrous-flight-zone";
const LABEL_POSITION: [number, number] = [-7.80, 31.755]; // Inside the supplied polygon.

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

  // DOM text uses the system font, including offline (no glyph endpoint required).
  const label = document.createElement("div");
  label.textContent = "Zone montgolfière Bourrous";
  Object.assign(label.style, {
    color: "#f3e8ff",
    background: "rgba(59, 7, 100, 0.85)",
    border: "1px solid #c084fc",
    borderRadius: "6px",
    padding: "4px 7px",
    font: "600 12px system-ui, sans-serif",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  });
  const marker = new maplibregl.Marker({ element: label, anchor: "center" })
    .setLngLat(LABEL_POSITION)
    .addTo(map);
  map.once("remove", () => marker.remove());
}
