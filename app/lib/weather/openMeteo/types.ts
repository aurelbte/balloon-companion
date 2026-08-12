import type { WindLevelUsed } from "../../trajectory/types.ts";
import { SUPPORTED_WEATHER_MODELS } from "../models.ts";

export const OPEN_METEO_WEATHER_MODELS = SUPPORTED_WEATHER_MODELS.map(
  (model) => model.providerModelId,
);

export type OpenMeteoWeatherModel = string;

export const OPEN_METEO_NEAR_SURFACE_LEVELS_AGL_M = [10, 80, 120, 180] as const;

export const OPEN_METEO_PRESSURE_LEVELS_HPA = [
  1000, 975, 950, 925, 900, 850, 800, 700,
] as const;

export type OpenMeteoWindColumnRequest = {
  latitude: number;
  longitude: number;
  validAt: string;
  weatherModel: OpenMeteoWeatherModel;
  terrainAltitudeAmslM?: number;
};

export type OpenMeteoWindColumnSlice = {
  validAt: string;
  levels: WindLevelUsed[];
  rejectedLevels: Array<{
    sourceLevel: string;
    reason: string;
  }>;
};

export type OpenMeteoWindColumn = {
  sourceModel: OpenMeteoWeatherModel;
  sourceLatitude: number;
  sourceLongitude: number;
  sourceElevationAmslM?: number;
  slices: OpenMeteoWindColumnSlice[];
};

export type NormalizedWeatherCode = "CLEAR" | "MAINLY_CLEAR" | "PARTLY_CLOUDY" | "OVERCAST" | "FOG" | "RIME_FOG" | "LIGHT_DRIZZLE" | "MODERATE_DRIZZLE" | "DENSE_DRIZZLE" | "LIGHT_FREEZING_DRIZZLE" | "DENSE_FREEZING_DRIZZLE" | "LIGHT_RAIN" | "MODERATE_RAIN" | "HEAVY_RAIN" | "LIGHT_FREEZING_RAIN" | "HEAVY_FREEZING_RAIN" | "LIGHT_SNOW" | "MODERATE_SNOW" | "HEAVY_SNOW" | "SNOW_GRAINS" | "LIGHT_RAIN_SHOWERS" | "MODERATE_RAIN_SHOWERS" | "VIOLENT_RAIN_SHOWERS" | "LIGHT_SNOW_SHOWERS" | "HEAVY_SNOW_SHOWERS" | "THUNDERSTORM" | "THUNDERSTORM_LIGHT_HAIL" | "THUNDERSTORM_HEAVY_HAIL" | "UNKNOWN";

/** Unités internes: °C, degrés vrais, km/h, mm, mètres et pourcentages. */
export type WeatherHourlyPoint = {
  timestamp: string;
  temperatureC?: number;
  windDirectionDeg?: number;
  windSpeedKmh?: number;
  windGustKmh?: number;
  humidityPercent?: number;
  precipitationMm?: number;
  visibilityM?: number;
  cloudCoverPercent?: number;
  weatherCode: NormalizedWeatherCode;
  model: OpenMeteoWeatherModel;
  /** Open-Meteo n'expose pas le run ici: heure réelle de récupération. */
  sourceUpdatedAt: string;
};

export type WeatherHourlyForecast = {
  model: OpenMeteoWeatherModel;
  latitude: number;
  longitude: number;
  sourceUpdatedAt: string;
  points: WeatherHourlyPoint[];
};

export type OpenMeteoApiTier = "free" | "commercial";

export type OpenMeteoClientConfig = {
  tier: OpenMeteoApiTier;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export interface OpenMeteoClient {
  fetchWindColumn(request: OpenMeteoWindColumnRequest): Promise<unknown>;
  fetchGroundTemperature(request: {
    latitude: number;
    longitude: number;
    validAt: string;
    weatherModel: OpenMeteoWeatherModel;
  }): Promise<unknown>;
  fetchHourlyForecast(request: {
    latitude: number;
    longitude: number;
    weatherModel: OpenMeteoWeatherModel;
  }): Promise<unknown>;
  fetchElevation(latitude: number, longitude: number): Promise<unknown>;
}

export const OPEN_METEO_ATTRIBUTION = {
  weather: {
    label: "Données météo par Open-Meteo.com — CC BY 4.0",
    url: "https://open-meteo.com/",
  },
  elevation: {
    label: "Élévation Open-Meteo — Copernicus DEM",
    url: "https://open-meteo.com/en/docs/elevation-api",
  },
} as const;
