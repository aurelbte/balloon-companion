import { TrajectoryDomainError } from "../../../lib/trajectory/types";
import { OpenMeteoWindProvider } from "../../../lib/weather/openMeteo/adapter";
import {
  createOpenMeteoClient,
  getOpenMeteoServerConfig,
} from "../../../lib/weather/openMeteo/client";
import { OPEN_METEO_ATTRIBUTION } from "../../../lib/weather/openMeteo/types";

function requiredString(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  return value?.trim() ? value.trim() : null;
}

function requiredNumber(params: URLSearchParams, name: string): number | null {
  const rawValue = requiredString(params, name);
  if (rawValue === null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function errorStatus(error: TrajectoryDomainError): number {
  if (
    [
      "INVALID_COORDINATES",
      "INVALID_DATE",
      "INVALID_TARGET_ALTITUDE",
      "UNSUPPORTED_WEATHER_MODEL",
    ].includes(error.code)
  ) {
    return 400;
  }
  if (
    ["MISSING_WIND_DATA", "ALTITUDE_NOT_BRACKETED", "TIME_NOT_BRACKETED"].includes(
      error.code,
    )
  ) {
    return 422;
  }
  return 502;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = requiredNumber(params, "lat");
  const longitude = requiredNumber(params, "lon");
  const validAt = requiredString(params, "validAt");
  const altitudeAmslM = requiredNumber(params, "altitudeAmslM");
  const weatherModel = requiredString(params, "weatherModel");

  if (
    latitude === null ||
    longitude === null ||
    validAt === null ||
    altitudeAmslM === null ||
    weatherModel === null
  ) {
    return Response.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message:
            "lat, lon, validAt, altitudeAmslM et weatherModel sont requis.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const provider = new OpenMeteoWindProvider(
      createOpenMeteoClient(getOpenMeteoServerConfig()),
    );
    const sample = await provider.getWind({
      latitude,
      longitude,
      validAt,
      altitudeAmslM,
      weatherModel,
    });

    return Response.json({
      data: sample,
      provider: "Open-Meteo",
      attribution: OPEN_METEO_ATTRIBUTION.weather,
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
        { status: errorStatus(error) },
      );
    }
    return Response.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Le service météo est indisponible.",
        },
      },
      { status: 502 },
    );
  }
}
