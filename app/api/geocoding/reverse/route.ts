import { selectFlightPlaceName, type FlightPlaceIdentity } from "../../../lib/journalFlightTitle.ts";
import { nominatimItemToFlightPlace, type Coordinate, type NominatimReverseItem } from "../../../lib/reverseGeocoding.ts";

const UNKNOWN_LABEL = "Lieu inconnu";

function validCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Coordinate>;
  return typeof point.latitude === "number" && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    typeof point.longitude === "number" && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}

async function reverse(point: Coordinate, requestOrigin: string): Promise<FlightPlaceIdentity> {
  const baseUrl = process.env.GEOCODING_REVERSE_BASE_URL?.trim() || "https://nominatim.openstreetmap.org/reverse";
  const url = new URL(baseUrl);
  url.searchParams.set("lat", String(point.latitude));
  url.searchParams.set("lon", String(point.longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("zoom", "18");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": "fr",
      referer: requestOrigin,
      "user-agent": "Balloon-Companion/1.0 (flight location finalization)",
    },
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return nominatimItemToFlightPlace(await response.json() as NominatimReverseItem, point);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  const payload = body as { start?: unknown; end?: unknown; preparedStartName?: unknown };
  if (!validCoordinate(payload.start) || !validCoordinate(payload.end)) {
    return Response.json({ error: { code: "INVALID_COORDINATES" } }, { status: 400 });
  }

  try {
    const startIdentity = await reverse(payload.start, new URL(request.url).origin);
    // Le service public Nominatim impose au maximum une requête par seconde.
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const endIdentity = await reverse(payload.end, new URL(request.url).origin);
    const preparedSiteName = typeof payload.preparedStartName === "string" ? payload.preparedStartName : null;
    return Response.json({
      startLocationLabel: selectFlightPlaceName({ ...startIdentity, preparedSiteName }, UNKNOWN_LABEL),
      endLocationLabel: selectFlightPlaceName(endIdentity, UNKNOWN_LABEL),
      attribution: "© OpenStreetMap contributors",
    });
  } catch {
    return Response.json({ error: { code: "REVERSE_GEOCODING_UNAVAILABLE" } }, { status: 502 });
  }
}
