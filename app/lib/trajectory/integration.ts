import type {
  LaunchSite,
  TrajectoryProjectionResult,
} from "./types.ts";
import { isValidCoordinate, isValidIsoDateTime } from "./validation.ts";
export {
  WEATHER_MODEL_REGISTRY,
  type WeatherModelDefinition,
  type WeatherModelId,
} from "../weather/models.ts";
import {
  weatherModelByProviderId,
  type WeatherModelDefinition,
} from "../weather/models.ts";
import { ALTITUDE_ANALYSIS_COLORS } from "./analysisStyles.ts";

export const ALTITUDE_OPTIONS = [
  "ground",
  100,
  300,
  600,
  1000,
  1500,
  2000,
  2500,
  3000,
] as const;
export type AltitudeOption = (typeof ALTITUDE_OPTIONS)[number];
export type NumericAltitudeOption = Exclude<AltitudeOption, "ground">;
export const DEFAULT_ALTITUDE_OPTIONS: readonly AltitudeOption[] = [
  "ground",
  300,
  600,
  1000,
];

export const ALTITUDE_COLORS: Record<string, string> = {
  ...ALTITUDE_ANALYSIS_COLORS,
  profile: "#ffffff",
};

export type TrajectoryProjectionRequest = {
  launchSite: {
    name: string;
    latitude: number;
    longitude: number;
  };
  launchDateTimeIso: string;
  durationSeconds: number;
  targetAltitudeAmslM: number;
  climbRateMps?: number;
  descentRateMps?: number;
  weatherModel: string;
};

export type TrajectoryApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type TrajectoryProjectionSuccess = {
  ok: true;
  projection: TrajectoryProjectionResult;
  metadata: {
    terrainAltitudeAmslM?: number;
    weatherModel: string;
    launchSite: LaunchSite;
  };
};

export type TrajectoryProjectionFailure = {
  ok: false;
  error: TrajectoryApiError;
};

export type TrajectoryProjectionApiResponse =
  | TrajectoryProjectionSuccess
  | TrajectoryProjectionFailure;

export type MultiAltitudeProjectionRequest = {
  version: 2;
  launchSite: TrajectoryProjectionRequest["launchSite"];
  launchDateTimeIso: string;
  durationSeconds: number;
  weatherModel: string;
  altitudesAmslM: AltitudeOption[];
  primaryAltitudeAmslM?: number;
  climbRateMps?: number;
  descentRateMps?: number;
};

export type AltitudeProjectionResult = {
  altitudeKey: string;
  altitudeAmslM: number;
  label: string;
  color: string;
  projection: TrajectoryProjectionResult;
};

export type AltitudeProjectionFailure = {
  altitudeKey: string;
  altitudeAmslM?: number;
  code: string;
  message: string;
  details?: unknown;
};

export type MultiAltitudeProjectionSuccess = {
  ok: true;
  version: 2;
  model: WeatherModelDefinition;
  launchSite: LaunchSite;
  terrainAltitudeAmslM: number;
  launchDateTimeIso: string;
  durationSeconds: number;
  selectedAltitudes: AltitudeOption[];
  primaryAltitudeAmslM?: number;
  layerProjections: AltitudeProjectionResult[];
  flightProfileProjection?: TrajectoryProjectionResult;
  failures: AltitudeProjectionFailure[];
};

export type MultiAltitudeProjectionApiResponse =
  | MultiAltitudeProjectionSuccess
  | TrajectoryProjectionFailure;

export type StoredTrajectoryProjectionV2 = {
  version: 2;
  createdAtIso: string;
  request: MultiAltitudeProjectionRequest;
  response: MultiAltitudeProjectionSuccess;
};

export type StoredTrajectoryProjectionV1 = {
  version: 1;
  createdAtIso: string;
  request: TrajectoryProjectionRequest;
  response: TrajectoryProjectionSuccess;
};

export type GeocodingResult = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type TrajectoryFormState = {
  launchSite: GeocodingResult | null;
  launchSearch: string;
  date: string;
  time: string;
  durationMinutes: string;
  targetAltitudeAmslM: string;
  selectedAltitudes: AltitudeOption[];
  weatherModel: string;
  climbRateMps: string;
  descentRateMps: string;
  balloonName: string;
};

export type TrajectoryTimeMarker = {
  minutes: number;
  elapsedSeconds: number;
  latitude: number;
  longitude: number;
  altitudeAmslM: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function altitudeKey(option: AltitudeOption): string {
  return option === "ground" ? "ground" : String(option);
}

export function altitudeLabel(option: AltitudeOption): string {
  return option === "ground" ? "Sol" : `${option} m`;
}

export function normalizeAltitudeOptions(
  values: readonly unknown[],
): AltitudeOption[] {
  const selected = new Set<AltitudeOption>();
  for (const option of ALTITUDE_OPTIONS) {
    if (values.some((value) => value === option)) selected.add(option);
  }
  return ALTITUDE_OPTIONS.filter((option) => selected.has(option));
}

export function validateMultiAltitudeProjectionRequest(
  value: unknown,
): MultiAltitudeProjectionRequest {
  if (!isRecord(value) || !Array.isArray(value.altitudesAmslM)) {
    throw new Error("INVALID_REQUEST");
  }
  const altitudesAmslM = normalizeAltitudeOptions(value.altitudesAmslM);
  if (
    altitudesAmslM.length === 0 ||
    altitudesAmslM.length !== new Set(value.altitudesAmslM).size
  ) {
    throw new Error("INVALID_ALTITUDES");
  }
  const base = validateTrajectoryProjectionRequest({
    ...value,
    targetAltitudeAmslM:
      altitudesAmslM.find((altitude): altitude is NumericAltitudeOption =>
        typeof altitude === "number",
      ) ?? 0,
    climbRateMps: undefined,
    descentRateMps: undefined,
  });
  const primaryAltitudeAmslM = value.primaryAltitudeAmslM;
  if (
    primaryAltitudeAmslM !== undefined &&
    (!finiteNumber(primaryAltitudeAmslM) ||
      !altitudesAmslM.includes(primaryAltitudeAmslM as AltitudeOption))
  ) {
    throw new Error("INVALID_PRIMARY_ALTITUDE");
  }
  for (const key of ["climbRateMps", "descentRateMps"] as const) {
    const rate = value[key];
    if (
      rate !== undefined &&
      (!finiteNumber(rate) || rate <= 0 || rate > 7 || rate * 2 % 1 !== 0)
    ) {
      throw new Error(
        key === "climbRateMps"
          ? "INVALID_CLIMB_RATE"
          : "INVALID_DESCENT_RATE",
      );
    }
  }
  return {
    version: 2,
    launchSite: base.launchSite,
    launchDateTimeIso: base.launchDateTimeIso,
    durationSeconds: base.durationSeconds,
    weatherModel: base.weatherModel,
    altitudesAmslM,
    ...(finiteNumber(primaryAltitudeAmslM)
      ? { primaryAltitudeAmslM }
      : {}),
    ...(finiteNumber(value.climbRateMps)
      ? { climbRateMps: value.climbRateMps }
      : {}),
    ...(finiteNumber(value.descentRateMps)
      ? { descentRateMps: value.descentRateMps }
      : {}),
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function durationMinutesToSeconds(minutes: number): number {
  return minutes * 60;
}

export function optionalVerticalRate(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function combineLocalDateAndTime(
  date: string,
  time: string,
): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time)
  ) {
    return null;
  }
  const local = new Date(`${date}T${time}:00`);
  if (!Number.isFinite(local.getTime())) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hours ||
    local.getMinutes() !== minutes
  ) {
    return null;
  }
  return local.toISOString();
}

export function validateTrajectoryProjectionRequest(
  value: unknown,
): TrajectoryProjectionRequest {
  if (!isRecord(value) || !isRecord(value.launchSite)) {
    throw new Error("INVALID_REQUEST");
  }
  const launchSite = value.launchSite;
  if (
    typeof launchSite.name !== "string" ||
    !launchSite.name.trim() ||
    !finiteNumber(launchSite.latitude) ||
    !finiteNumber(launchSite.longitude) ||
    !isValidCoordinate({
      latitude: launchSite.latitude,
      longitude: launchSite.longitude,
    })
  ) {
    throw new Error("INVALID_COORDINATES");
  }
  if (
    typeof value.launchDateTimeIso !== "string" ||
    !isValidIsoDateTime(value.launchDateTimeIso)
  ) {
    throw new Error("INVALID_DATE");
  }
  if (!finiteNumber(value.durationSeconds) || value.durationSeconds <= 0) {
    throw new Error("INVALID_DURATION");
  }
  if (
    !finiteNumber(value.targetAltitudeAmslM) ||
    value.targetAltitudeAmslM < 0
  ) {
    throw new Error("INVALID_TARGET_ALTITUDE");
  }
  for (const key of ["climbRateMps", "descentRateMps"] as const) {
    const rate = value[key];
    if (rate !== undefined && (!finiteNumber(rate) || rate <= 0)) {
      throw new Error(
        key === "climbRateMps"
          ? "INVALID_CLIMB_RATE"
          : "INVALID_DESCENT_RATE",
      );
    }
  }
  if (
    typeof value.weatherModel !== "string" ||
    !weatherModelByProviderId(value.weatherModel)?.supported
  ) {
    throw new Error("UNSUPPORTED_WEATHER_MODEL");
  }
  return {
    launchSite: {
      name: launchSite.name.trim(),
      latitude: launchSite.latitude,
      longitude: launchSite.longitude,
    },
    launchDateTimeIso: value.launchDateTimeIso,
    durationSeconds: value.durationSeconds,
    targetAltitudeAmslM: value.targetAltitudeAmslM,
    ...(finiteNumber(value.climbRateMps)
      ? { climbRateMps: value.climbRateMps }
      : {}),
    ...(finiteNumber(value.descentRateMps)
      ? { descentRateMps: value.descentRateMps }
      : {}),
    weatherModel: value.weatherModel,
  };
}

export function trajectoryErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    TERRAIN_ALTITUDE_REQUIRED:
      "L’altitude du terrain n’a pas pu être déterminée. Elle est nécessaire pour calculer la montée ou la descente.",
    TARGET_BELOW_TERRAIN:
      "L’altitude cible doit être supérieure ou égale à l’altitude du terrain.",
    INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE:
      "La durée prévue est insuffisante pour effectuer la montée et la descente renseignées.",
    ALTITUDE_NOT_BRACKETED:
      "Les données météo disponibles ne couvrent pas l’une des altitudes traversées.",
    WEATHER_VERTICAL_COVERAGE_INSUFFICIENT:
      "La colonne météo ne couvre pas l’altitude demandée.",
    WEATHER_MODEL_OUT_OF_COVERAGE:
      "Le modèle météo ne couvre pas ce point de départ.",
    WEATHER_FORECAST_HORIZON_EXCEEDED:
      "Le modèle météo ne couvre pas cette échéance.",
    WEATHER_NEAR_SURFACE_DATA_MISSING:
      "Le modèle ne fournit pas de vent proche du sol exploitable.",
    WEATHER_PRESSURE_LEVEL_DATA_MISSING:
      "Le modèle ne fournit pas les niveaux de pression nécessaires.",
    WEATHER_GEOPOTENTIAL_HEIGHT_MISSING:
      "Le modèle ne fournit pas les hauteurs géopotentielles nécessaires.",
    WEATHER_COLUMN_INVALID:
      "La colonne météo reçue n’est pas exploitable.",
    INVALID_WIND:
      "Les données de vent reçues sont invalides pour cette projection.",
    TIME_NOT_BRACKETED:
      "Les données météo ne couvrent pas toute la durée demandée.",
  };
  return (
    messages[code] ??
    "La projection n’a pas pu être calculée. Vérifiez la connexion et réessayez."
  );
}

export function trajectoryModeLabel(
  mode: TrajectoryProjectionResult["mode"],
): string {
  const labels: Record<TrajectoryProjectionResult["mode"], string> = {
    "constant-altitude": "Altitude constante",
    "climb-then-level": "Montée puis palier",
    "level-then-descent": "Palier puis descente",
    "climb-level-descent": "Montée, palier et descente",
  };
  return labels[mode];
}
