import type { FlightPlaceIdentity } from "./journalFlightTitle.ts";

export type Coordinate = { latitude: number; longitude: number };
export type NominatimReverseItem = {
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  boundingbox?: string[];
  address?: Record<string, string | undefined>;
  extratags?: Record<string, string | undefined>;
};

function pointInsideBoundingBox(point: Coordinate, rawBounds: string[] | undefined): boolean {
  if (!rawBounds || rawBounds.length !== 4) return false;
  const [south, north, west, east] = rawBounds.map(Number);
  return [south, north, west, east].every(Number.isFinite) &&
    point.latitude >= south! && point.latitude <= north! &&
    point.longitude >= west! && point.longitude <= east!;
}

export function nominatimItemToFlightPlace(
  item: NominatimReverseItem,
  point: Coordinate,
): FlightPlaceIdentity {
  const address = item.address ?? {};
  const aerodromeResult = item.category === "aeroway" && item.type === "aerodrome";
  const identifiedAerodrome = aerodromeResult && pointInsideBoundingBox(point, item.boundingbox);
  return {
    identifiedAerodrome,
    icaoCode: identifiedAerodrome
      ? item.extratags?.icao ?? address.icao ?? address.aerodrome
      : null,
    aerodromeName: identifiedAerodrome ? item.name ?? address.aerodrome : null,
    municipality: address.city ?? address.town ?? address.village ?? address.municipality ?? address.hamlet ?? null,
  };
}
