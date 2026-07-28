export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type LaunchSite = GeoPoint & {
  name: string;
  terrainAltitudeAmslM?: number;
};

export type WindVector = {
  directionFromDeg: number;
  speedMps: number;
};

export type WindQuery = GeoPoint & {
  validAt: string;
  altitudeAmslM: number;
  weatherModel: string;
};

export type WindLevelUsed = {
  pressureHpa?: number;
  geopotentialHeightAmslM: number;
  windSpeedMps: number;
  windDirectionFromDeg: number;
  sourceType?: "surface" | "near-surface" | "pressure-level";
  sourceLevel?: string;
  isApproximation?: boolean;
};

export type WindSourceSlice = {
  validAt: string;
  wind: WindVector;
  lowerLevel: WindLevelUsed;
  upperLevel: WindLevelUsed;
  verticalInterpolationRatio: number;
};

export type WindSample = {
  query: WindQuery;
  wind: WindVector;
  sourceModel: string;
  sourceLatitude: number;
  sourceLongitude: number;
  sourceSlices: WindSourceSlice[];
  temporalInterpolation?: {
    before: string;
    after: string;
    ratio: number;
  };
  warnings: string[];
};

export interface WindProvider {
  getWind(query: WindQuery): Promise<WindSample>;
  /**
   * Prépare facultativement une source locale limitée à une projection.
   * Le moteur peut ensuite échantillonner plusieurs instants sans nouvel appel réseau.
   */
  prepareProjection?(query: WindQuery): Promise<WindProvider>;
}

export type TrajectoryProjectionInput = {
  start: LaunchSite;
  departureTime: string;
  durationSeconds: number;
  weatherModel: string;
  targetAltitudeAmslM: number;
  climbRateMps?: number;
  /**
   * Conservé pour une future définition du profil vertical.
   * La V1 ne crée aucune phase de descente à partir de cette seule valeur.
   */
  descentRateMps?: number;
};

export type TrajectoryValidationDraft = Omit<
  TrajectoryProjectionInput,
  "targetAltitudeAmslM"
> & {
  targetAltitudeAmslM?: number | null;
};

export type TrajectoryWindUsed = {
  queryAltitudeAmslM: number;
  speedMps: number;
  directionFromDeg: number;
  movementDirectionToDeg: number;
  sourceModel: string;
  sourceLatitude: number;
  sourceLongitude: number;
  sourceSlices: Array<{
    validAt: string;
    lowerLevel: {
      pressureHpa?: number;
      geopotentialHeightAmslM: number;
    };
    upperLevel: {
      pressureHpa?: number;
      geopotentialHeightAmslM: number;
    };
    verticalInterpolationRatio: number;
  }>;
  temporalInterpolation?: {
    before: string;
    after: string;
    ratio: number;
  };
};

export type TrajectoryPoint = GeoPoint & {
  timestamp: string;
  elapsedSeconds: number;
  altitudeAmslM: number;
  verticalPhase: "initial" | "climb" | "level" | "descent";
  windUsed?: TrajectoryWindUsed;
};

export type TrajectoryWarning = {
  code: "LAUNCH_COLUMN_ONLY" | "WEATHER_PROVIDER_WARNING";
  message: string;
};

export type TrajectoryProjectionResult = {
  mode:
    | "constant-altitude"
    | "climb-then-level"
    | "level-then-descent"
    | "climb-level-descent";
  spatialStrategy: "launch-column";
  points: TrajectoryPoint[];
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  stepSeconds: number;
  targetAltitudeAmslM: number;
  verticalProfile: {
    terrainAltitudeAmslM?: number;
    targetAltitudeAmslM: number;
    climbRateMps?: number;
    climbDurationSeconds?: number;
    climbEndElapsedSeconds?: number;
    descentRateMps?: number;
    descentDurationSeconds?: number;
    descentStartElapsedSeconds?: number;
  };
  weatherModel: string;
  weatherSourceModels: string[];
  warnings: TrajectoryWarning[];
};

export type TrajectoryErrorCode =
  | "INVALID_COORDINATES"
  | "INVALID_DATE"
  | "INVALID_DURATION"
  | "MISSING_TARGET_ALTITUDE"
  | "INVALID_TARGET_ALTITUDE"
  | "UNSUPPORTED_WEATHER_MODEL"
  | "INVALID_CLIMB_RATE"
  | "INVALID_DESCENT_RATE"
  | "MISSING_WIND_DATA"
  | "ALTITUDE_NOT_BRACKETED"
  | "TIME_NOT_BRACKETED"
  | "INVALID_PROVIDER_RESPONSE"
  | "ELEVATION_UNAVAILABLE"
  | "UPSTREAM_UNAVAILABLE"
  | "TARGET_BELOW_TERRAIN"
  | "INVALID_STEP"
  | "INVALID_WIND"
  | "NON_FINITE_GEOGRAPHIC_RESULT"
  | "TERRAIN_ALTITUDE_REQUIRED"
  | "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE"
  | "VERTICAL_PROFILE_OUT_OF_BOUNDS"
  | "WEATHER_MODEL_UNAVAILABLE"
  | "WEATHER_MODEL_OUT_OF_COVERAGE"
  | "WEATHER_FORECAST_HORIZON_EXCEEDED"
  | "WEATHER_VERTICAL_COVERAGE_INSUFFICIENT"
  | "WEATHER_NEAR_SURFACE_DATA_MISSING"
  | "WEATHER_PRESSURE_LEVEL_DATA_MISSING"
  | "WEATHER_GEOPOTENTIAL_HEIGHT_MISSING"
  | "WEATHER_COLUMN_INVALID"
  | "WEATHER_TIMESTAMP_UNAVAILABLE";

export class TrajectoryDomainError extends Error {
  readonly code: TrajectoryErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: TrajectoryErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TrajectoryDomainError";
    this.code = code;
    this.details = details;
  }
}
