import type { GeocodingResult } from "./trajectory/integration.ts";
import { isValidCoordinate } from "./trajectory/validation.ts";

type NominatimItem = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
};

export function parseNominatimResults(payload: unknown): GeocodingResult[] {
  return Array.isArray(payload)
    ? payload.flatMap((item: NominatimItem) => {
        if (typeof item.lat !== "string" || !item.lat.trim() || typeof item.lon !== "string" || !item.lon.trim()) return [];
        const latitude = Number(item.lat);
        const longitude = Number(item.lon);
        return item.place_id !== undefined &&
          typeof item.display_name === "string" &&
          isValidCoordinate({ latitude, longitude })
          ? [{ id: String(item.place_id), name: item.display_name, latitude, longitude }]
          : [];
      })
    : [];
}
