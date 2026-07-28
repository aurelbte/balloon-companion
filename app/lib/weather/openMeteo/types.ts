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

export type OpenMeteoApiTier = "free" | "commercial";

export type OpenMeteoClientConfig = {
  tier: OpenMeteoApiTier;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export interface OpenMeteoClient {
  fetchWindColumn(request: OpenMeteoWindColumnRequest): Promise<unknown>;
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
