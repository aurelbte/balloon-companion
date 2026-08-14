import { TrajectoryDomainError } from "../../trajectory/types.ts";
import {
  OPEN_METEO_PRESSURE_LEVELS_HPA,
  OPEN_METEO_NEAR_SURFACE_LEVELS_AGL_M,
  type OpenMeteoClient,
  type OpenMeteoClientConfig,
  type OpenMeteoWindColumnRequest,
} from "./types.ts";

const FREE_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const COMMERCIAL_FORECAST_URL =
  "https://customer-api.open-meteo.com/v1/forecast";
const FREE_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const COMMERCIAL_ELEVATION_URL =
  "https://customer-api.open-meteo.com/v1/elevation";

function datePart(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function datePartInTimeZone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function hourlyVariables(): string {
  const variables: string[] = [];
  for (const heightAglM of OPEN_METEO_NEAR_SURFACE_LEVELS_AGL_M) {
    variables.push(
      `wind_speed_${heightAglM}m`,
      `wind_direction_${heightAglM}m`,
    );
  }
  for (const pressureHpa of OPEN_METEO_PRESSURE_LEVELS_HPA) {
    variables.push(
      `wind_speed_${pressureHpa}hPa`,
      `wind_direction_${pressureHpa}hPa`,
      `geopotential_height_${pressureHpa}hPa`,
    );
  }
  return variables.join(",");
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
): Promise<unknown> {
  let response: Response;
  const isGroundTemperatureRequest = url.searchParams.get("hourly") === "temperature_2m";
  try {
    if (process.env.NODE_ENV === "development" && isGroundTemperatureRequest) {
      const safeUrl = new URL(url);
      safeUrl.searchParams.delete("apikey");
      console.info("[ground-weather] Open-Meteo request", safeUrl.toString());
    }
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    throw new TrajectoryDomainError(
      "UPSTREAM_UNAVAILABLE",
      "Le service Open-Meteo est inaccessible.",
      { cause: error instanceof Error ? error.name : "UnknownError" },
    );
  }

  if (process.env.NODE_ENV === "development" && isGroundTemperatureRequest) console.info("[ground-weather] Open-Meteo status", response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TrajectoryDomainError(
      "INVALID_PROVIDER_RESPONSE",
      "Open-Meteo n’a pas renvoyé de JSON valide.",
      { status: response.status },
    );
  }

  if (!response.ok) {
    const reason =
      typeof payload === "object" &&
      payload !== null &&
      "reason" in payload &&
      typeof payload.reason === "string"
        ? payload.reason
        : `Open-Meteo a répondu avec le statut ${response.status}.`;
    if (process.env.NODE_ENV === "development" && isGroundTemperatureRequest) console.error("[ground-weather] Open-Meteo error", { status: response.status, reason });
    throw new TrajectoryDomainError("UPSTREAM_UNAVAILABLE", reason, {
      status: response.status,
    });
  }

  return payload;
}

export function createOpenMeteoClient(
  config: OpenMeteoClientConfig,
): OpenMeteoClient {
  if (config.tier === "commercial" && !config.apiKey) {
    throw new TrajectoryDomainError(
      "UPSTREAM_UNAVAILABLE",
      "La clé Open-Meteo commerciale n’est pas configurée.",
    );
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const forecastUrl =
    config.tier === "commercial" ? COMMERCIAL_FORECAST_URL : FREE_FORECAST_URL;
  const elevationUrl =
    config.tier === "commercial"
      ? COMMERCIAL_ELEVATION_URL
      : FREE_ELEVATION_URL;

  const addApiKey = (url: URL) => {
    if (config.tier === "commercial" && config.apiKey) {
      url.searchParams.set("apikey", config.apiKey);
    }
  };

  return {
    async fetchWindColumn(request: OpenMeteoWindColumnRequest) {
      const requestedAt = new Date(request.validAt);
      const url = new URL(forecastUrl);
      url.searchParams.set("latitude", String(request.latitude));
      url.searchParams.set("longitude", String(request.longitude));
      url.searchParams.set("hourly", hourlyVariables());
      url.searchParams.set("wind_speed_unit", "ms");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("start_date", datePart(requestedAt));
      url.searchParams.set("end_date", datePart(addUtcDays(requestedAt, 1)));
      url.searchParams.set("models", request.weatherModel);
      addApiKey(url);
      return fetchJson(fetchImpl, url);
    },

    async fetchGroundTemperature(request) {
      const requestedAt = new Date(request.validAt);
      const url = new URL(forecastUrl);
      url.searchParams.set("latitude", String(request.latitude));
      url.searchParams.set("longitude", String(request.longitude));
      url.searchParams.set("hourly", "temperature_2m");
      url.searchParams.set("timezone", "Europe/Paris");
      url.searchParams.set("start_date", datePartInTimeZone(requestedAt, "Europe/Paris"));
      url.searchParams.set("end_date", datePartInTimeZone(addUtcDays(requestedAt, 1), "Europe/Paris"));
      // Le flux de température DEMO utilise la prévision générique Open-Meteo,
      // indépendamment du modèle vertical choisi pour les trajectoires.
      addApiKey(url);
      return fetchJson(fetchImpl, url);
    },

    async fetchHourlyForecast(request) {
      const url = new URL(forecastUrl);
      url.searchParams.set("latitude", String(request.latitude));
      url.searchParams.set("longitude", String(request.longitude));
      url.searchParams.set("hourly", ["temperature_2m", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"].join(","));
      url.searchParams.set("wind_speed_unit", "kmh");
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("forecast_days", "7");
      url.searchParams.set("models", request.weatherModel);
      addApiKey(url);
      return fetchJson(fetchImpl, url);
    },

    async fetchHourlyForecastBatch(requests) {
      if (requests.length === 0) return [];
      const url = new URL(forecastUrl);
      url.searchParams.set("latitude", requests.map(({ latitude }) => latitude).join(","));
      url.searchParams.set("longitude", requests.map(({ longitude }) => longitude).join(","));
      url.searchParams.set("hourly", ["temperature_2m", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"].join(","));
      url.searchParams.set("wind_speed_unit", "kmh");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("forecast_days", "7");
      url.searchParams.set("models", requests[0].weatherModel);
      addApiKey(url);
      return fetchJson(fetchImpl, url);
    },

    async fetchElevation(latitude: number, longitude: number) {
      const url = new URL(elevationUrl);
      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      addApiKey(url);
      return fetchJson(fetchImpl, url);
    },
  };
}

export function getOpenMeteoServerConfig(
  environment: Record<string, string | undefined> = process.env,
): OpenMeteoClientConfig {
  const tier =
    environment.OPEN_METEO_API_TIER === "commercial" ? "commercial" : "free";
  return {
    tier,
    ...(environment.OPEN_METEO_API_KEY
      ? { apiKey: environment.OPEN_METEO_API_KEY }
      : {}),
  };
}
