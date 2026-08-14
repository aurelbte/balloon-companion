import {
  TrajectoryDomainError,
  type GeoPoint,
} from "../../lib/trajectory/types";
import { isValidCoordinate } from "../../lib/trajectory/validation";
import {
  createOpenMeteoClient,
  getOpenMeteoServerConfig,
} from "../../lib/weather/openMeteo/client";
import { parseOpenMeteoElevation } from "../../lib/weather/openMeteo/parser";
import { OPEN_METEO_ATTRIBUTION } from "../../lib/weather/openMeteo/types";

function requiredNumber(params: URLSearchParams, name: string): number | null {
  const rawValue = params.get(name);
  if (rawValue === null || rawValue.trim() === "") return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = requiredNumber(params, "lat");
  const longitude = requiredNumber(params, "lon");

  if (latitude === null || longitude === null) {
    return Response.json(
      {
        error: {
          code: "INVALID_COORDINATES",
          message: "lat et lon sont requis.",
        },
      },
      { status: 400 },
    );
  }

  const point: GeoPoint = { latitude, longitude };
  if (!isValidCoordinate(point)) {
    return Response.json(
      {
        error: {
          code: "INVALID_COORDINATES",
          message: "Les coordonnées sont invalides.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const client = createOpenMeteoClient(getOpenMeteoServerConfig());
    const payload = await client.fetchElevation(latitude, longitude);
    const elevationAmslM = parseOpenMeteoElevation(payload);
    return Response.json({
      data: {
        latitude,
        longitude,
        elevationAmslM,
      },
      provider: "Open-Meteo",
      attribution: OPEN_METEO_ATTRIBUTION.elevation,
    });
  } catch (error) {
    if (error instanceof TrajectoryDomainError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        {
          status:
            error.code === "ELEVATION_UNAVAILABLE" ||
            error.code === "INVALID_PROVIDER_RESPONSE"
              ? 422
              : 502,
        },
      );
    }
    return Response.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Le service d’élévation est indisponible.",
        },
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_COORDINATES", message: "Corps JSON invalide." } }, { status: 400 }); }
  const points = body && typeof body === "object" && Array.isArray((body as { points?: unknown }).points) ? (body as { points: unknown[] }).points : [];
  const validPoints = points.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const { latitude, longitude } = point as { latitude?: unknown; longitude?: unknown };
    const candidate = { latitude: Number(latitude), longitude: Number(longitude) };
    return isValidCoordinate(candidate) ? [candidate] : [];
  });
  if (validPoints.length === 0 || validPoints.length !== points.length || validPoints.length > 100) return Response.json({ error: { code: "INVALID_COORDINATES", message: "1 à 100 coordonnées valides sont requises." } }, { status: 400 });
  try {
    const client = createOpenMeteoClient(getOpenMeteoServerConfig());
    const payload = await client.fetchElevationBatch(validPoints) as { elevation?: unknown };
    const elevations = Array.isArray(payload?.elevation) ? payload.elevation : [];
    if (elevations.length !== validPoints.length) throw new TrajectoryDomainError("INVALID_PROVIDER_RESPONSE", "Réponse d’élévation groupée invalide.");
    const data = validPoints.map((point, index) => ({ ...point, elevationAmslM: Number(elevations[index]) }));
    if (data.some(({ elevationAmslM }) => !Number.isFinite(elevationAmslM))) throw new TrajectoryDomainError("INVALID_PROVIDER_RESPONSE", "Élévation groupée invalide.");
    return Response.json({ data, provider: "Open-Meteo", attribution: OPEN_METEO_ATTRIBUTION.elevation });
  } catch { return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Le service d’élévation est indisponible." } }, { status: 502 }); }
}
