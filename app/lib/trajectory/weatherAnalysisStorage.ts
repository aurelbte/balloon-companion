import type {
  AltitudeOption,
  AltitudeProjectionFailure,
  AltitudeProjectionResult,
} from "./integration.ts";
import type { WeatherModelDefinition } from "../weather/models.ts";

export type AnalysisLayerSettings = {
  trajectories: boolean;
  airspaces: boolean;
  aeronauticalMap: boolean;
  satellite: boolean;
  highContrast: boolean;
  timeMarkers: boolean;
  arrivalMarkers: boolean;
};

export type WeatherAnalysisTrace = AltitudeProjectionResult & {
  traceId: string;
  model: WeatherModelDefinition;
  calculatedAtIso: string;
  forecastAtIso: string;
};

export type WeatherAnalysisState = {
  version: 1;
  updatedAtIso: string;
  selectedModelIds: string[];
  selectedAltitudes: AltitudeOption[];
  layers: AnalysisLayerSettings;
  traces: WeatherAnalysisTrace[];
  failures: Array<AltitudeProjectionFailure & { modelId: string }>;
  analysisKey?: string;
};

export type ExportedPlannedTrajectory = {
  version: 1;
  traceId: string;
  modelId: string;
  modelLabel: string;
  providerModelId: string;
  altitudeKey: string;
  altitudeAmslM: number;
  altitudeLabel: string;
  color: string;
  dasharray: readonly number[];
  geometry: Array<[number, number]>;
  calculatedAtIso: string;
  forecastAtIso: string;
};

const ANALYSIS_KEY = "balloon_companion_weather_analysis_v1";
const FLIGHT_EXPORT_KEY = "balloon_companion_planned_trajectories_v1";

export const DEFAULT_ANALYSIS_LAYERS: AnalysisLayerSettings = {
  trajectories: true,
  airspaces: false,
  aeronauticalMap: false,
  satellite: true,
  highContrast: false,
  timeMarkers: true,
  arrivalMarkers: true,
};

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function loadWeatherAnalysis(): WeatherAnalysisState | null {
  const value = readJson(ANALYSIS_KEY);
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Partial<WeatherAnalysisState>).version !== 1
  ) {
    return null;
  }
  const candidate = value as Partial<WeatherAnalysisState>;
  return Array.isArray(candidate.selectedModelIds) &&
    Array.isArray(candidate.selectedAltitudes) &&
    Array.isArray(candidate.traces) &&
    Array.isArray(candidate.failures) &&
    typeof candidate.layers === "object" &&
    candidate.layers !== null
    ? (value as WeatherAnalysisState)
    : null;
}

export function saveWeatherAnalysis(value: WeatherAnalysisState): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(ANALYSIS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadExportedPlannedTrajectories(): ExportedPlannedTrajectory[] {
  const value = readJson(FLIGHT_EXPORT_KEY);
  return Array.isArray(value)
    ? value.filter(
        (item): item is ExportedPlannedTrajectory =>
          typeof item === "object" &&
          item !== null &&
          (item as Partial<ExportedPlannedTrajectory>).version === 1 &&
          Array.isArray(
            (item as Partial<ExportedPlannedTrajectory>).geometry,
          ),
      )
    : [];
}

export function saveExportedPlannedTrajectories(
  trajectories: ExportedPlannedTrajectory[],
): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(FLIGHT_EXPORT_KEY, JSON.stringify(trajectories));
    return true;
  } catch {
    return false;
  }
}
