import type { Map } from "maplibre-gl";

export const RELIEF_SOURCE_ID = "bc-relief-dem";
const LAYER_ID = "bc-relief-hillshade";

/** Removing the source, rather than hiding the layer, stops DEM loading while OFF. */
export function syncMapRelief(map: Map, enabled: boolean, apiKey: string | undefined, baseLayerIds: readonly string[]) {
  const key = apiKey?.trim();
  if (!enabled || !key) {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(RELIEF_SOURCE_ID)) map.removeSource(RELIEF_SOURCE_ID);
    return;
  }
  if (!map.getSource(RELIEF_SOURCE_ID)) {
    map.addSource(RELIEF_SOURCE_ID, {
      type: "raster-dem",
      url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(key)}`,
      encoding: "mapbox",
      attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a>',
    });
  }
  if (!map.getLayer(LAYER_ID)) {
    // Above both raster backgrounds, below every existing overlay.
    const before = map.getStyle().layers?.find(layer => !baseLayerIds.includes(layer.id))?.id;
    map.addLayer({
      id: LAYER_ID,
      type: "hillshade",
      source: RELIEF_SOURCE_ID,
      paint: { "hillshade-exaggeration": 0.35 },
    }, before);
  }
}
