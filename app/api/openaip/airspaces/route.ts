const OPENAIP_AIRSPACES_URL =
  "https://api.core.openaip.net/api/airspaces";

function parseNumberParameter(
  searchParams: URLSearchParams,
  name: "lat" | "lon" | "dist" | "page"
): number | null {
  const rawValue = searchParams.get(name);
  if (rawValue === null || rawValue.trim() === "") return null;

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const apiKey = process.env.OPENAIP_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.error("[OpenAIP proxy] OPENAIP_API_KEY is missing", {
        requestId,
      });
    }
    return Response.json(
      { error: "OpenAIP API key is not configured" },
      { status: 500 }
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const lat = parseNumberParameter(searchParams, "lat");
  const lon = parseNumberParameter(searchParams, "lon");
  const dist = parseNumberParameter(searchParams, "dist");
  const page = searchParams.has("page")
    ? parseNumberParameter(searchParams, "page")
    : null;

  if (
    lat === null ||
    lon === null ||
    dist === null ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    dist <= 0 ||
    (searchParams.has("page") &&
      (page === null || !Number.isInteger(page) || page < 1))
  ) {
    return Response.json(
      { error: "Valid lat, lon and positive dist parameters are required" },
      { status: 400 }
    );
  }

  const openAipUrl = new URL(OPENAIP_AIRSPACES_URL);
  openAipUrl.searchParams.set("pos", `${lat},${lon}`);
  openAipUrl.searchParams.set("dist", String(dist));
  if (page !== null) openAipUrl.searchParams.set("page", String(page));

  try {
    const openAipResponse = await fetch(openAipUrl, {
      headers: {
        "x-openaip-api-key": apiKey,
      },
      cache: "no-store",
    });
    const responseBody = await openAipResponse.arrayBuffer();

    if (
      !openAipResponse.ok &&
      process.env.NODE_ENV === "development"
    ) {
      const usefulHeaders = Object.fromEntries(
        [
          "retry-after",
          "ratelimit-limit",
          "ratelimit-remaining",
          "ratelimit-reset",
          "x-ratelimit-limit",
          "x-ratelimit-remaining",
          "x-ratelimit-reset",
        ]
          .map((name) => [name, openAipResponse.headers.get(name)] as const)
          .filter((entry): entry is [string, string] => entry[1] !== null)
      );
      console.error("[OpenAIP proxy] request failed", {
        requestId,
        status: openAipResponse.status,
        parameters: { lat, lon, dist, page },
        rateLimitHeaders: usefulHeaders,
      });
    }

    const responseHeaders = new Headers();
    const contentType = openAipResponse.headers.get("content-type");
    const retryAfter = openAipResponse.headers.get("retry-after");

    if (contentType) responseHeaders.set("content-type", contentType);
    if (retryAfter) responseHeaders.set("retry-after", retryAfter);

    responseHeaders.set("x-balloon-request-id", requestId);

    return new Response(responseBody, {
      status: openAipResponse.status,
      statusText: openAipResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[OpenAIP proxy] upstream unavailable", {
        requestId,
        category: error instanceof Error ? error.name : "UnknownError",
        parameters: { lat, lon, dist, page },
      });
    }
    return Response.json(
      { error: "OpenAIP service is unavailable" },
      { status: 502 }
    );
  }
}
