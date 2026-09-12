import { selectFlightPlaceName, type FlightPlaceIdentity } from "../../../lib/journalFlightTitle.ts";
import { REVERSE_GEOCODING_GAP_MS, REVERSE_GEOCODING_TIMEOUT_MS, nominatimItemToFlightPlace, type Coordinate, type NominatimReverseItem } from "../../../lib/reverseGeocoding.ts";

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
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          signal: controller.signal,
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
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("GEOCODING_TIMEOUT")); }, REVERSE_GEOCODING_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  const payload = body as { start?: unknown; end?: unknown; preparedStartName?: unknown };
  if (!payload || typeof payload !== "object" ||
    (payload.start === undefined && payload.end === undefined) ||
    (payload.start !== undefined && !validCoordinate(payload.start)) ||
    (payload.end !== undefined && !validCoordinate(payload.end))) {
    return Response.json({ error: { code: "INVALID_COORDINATES" } }, { status: 400 });
  }

  const labels: { startLocationLabel?: string; endLocationLabel?: string } = {};
  const origin = new URL(request.url).origin;
  if (validCoordinate(payload.start)) {
    try {
      const identity = await reverse(payload.start, origin);
      labels.startLocationLabel = selectFlightPlaceName({ ...identity,
        preparedSiteName: typeof payload.preparedStartName === "string" ? payload.preparedStartName : null }, UNKNOWN_LABEL);
    } catch { /* Preserve the independent arrival attempt. */ }
  }
  if (validCoordinate(payload.end)) {
    if (payload.start !== undefined) await new Promise(resolve => setTimeout(resolve, REVERSE_GEOCODING_GAP_MS));
    try { labels.endLocationLabel = selectFlightPlaceName(await reverse(payload.end, origin), UNKNOWN_LABEL); }
    catch { /* Return any successful departure result. */ }
  }
  return Response.json({ ...labels, attribution: "© OpenStreetMap contributors" });
}
