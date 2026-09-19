import type { GeocodingResult } from "../../../lib/trajectory/integration";
import { parseNominatimResults } from "../../../lib/geocodingSearch";

let lastUpstreamRequestAt = 0;
const MIN_UPSTREAM_INTERVAL_MS = 1_000;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2 || query.length > 120) {
    return Response.json(
      { error: { code: "INVALID_QUERY", message: "La recherche doit contenir entre 2 et 120 caractères." } },
      { status: 400 },
    );
  }

  const now = Date.now();
  if (now - lastUpstreamRequestAt < MIN_UPSTREAM_INTERVAL_MS) {
    return Response.json(
      {
        error: {
          code: "GEOCODING_RATE_LIMITED",
          message: "Patientez un instant avant une nouvelle recherche.",
        },
      },
      { status: 429 },
    );
  }
  lastUpstreamRequestAt = now;

  const url = new URL(
    process.env.GEOCODING_BASE_URL?.trim() ||
      "https://nominatim.openstreetmap.org/search",
  );
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "accept-language": "fr",
          referer: new URL(request.url).origin,
          "user-agent": "Balloon-Companion/1.0 (geocoding for flight preparation)",
        },
        cache: "force-cache",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
    } finally {
      clearTimeout(timeout);
    }
    const results: GeocodingResult[] = parseNominatimResults(payload);
    return Response.json({
      results,
      attribution: "© OpenStreetMap contributors",
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "GEOCODING_UNAVAILABLE",
          message: "La recherche de lieu est indisponible.",
        },
      },
      { status: 502 },
    );
  }
}
