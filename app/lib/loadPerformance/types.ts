export type LoadUnavailableReasonCode =
  | "NO_BALLOON"
  | "INCOMPLETE_BALLOON_MASSES"
  | "NO_OCCUPANTS_WEIGHT"
  | "NO_MAXIMUM_ALTITUDE"
  | "NO_LAUNCH_ELEVATION"
  | "NO_GROUND_TEMPERATURE"
  | "UNSUPPORTED_MODEL"
  | "UNSUPPORTED_OFFICIAL_DATASET"
  | "OUTSIDE_OFFICIAL_TABLE"
  | "OUTSIDE_DEMO_TABLE"
  | "MISSING_MTOW"
  | "CONFIGURATION_LIMIT_MISSING"
  | "CONFIGURATION_LIMITS_UNCONFIRMED"
  | "VOLUME_MISMATCH"
  | "PENDING_VERIFICATION";

export type ManufacturerCalculationStatus =
  | "OFFICIAL_VALIDATED"
  | "CANDIDATE_PILOT_VALIDATION"
  | "PENDING_VERIFICATION"
  | "UNSUPPORTED";

export type GroundTemperature = {
  temperatureC: number;
  sourceModel: string;
  forecastRun: string;
  validTime: string;
  forecastOffsetMinutes?: number;
  provider?: string;
};

export type LoadCalculationInput = {
  balloonId?: string;
  manufacturer?: string;
  model?: string;
  volumeM3?: number;
  officialManualId?: string;
  officialManualRevision?: string;
  officialLoadDatasetId?: string;
  balloonEquipmentWeightKg?: number;
  occupantsWeightKg?: number;
  launchLatitude?: number;
  launchLongitude?: number;
  launchElevationMslM?: number;
  launchDateTime?: string;
  plannedMaximumAltitudeMslM?: number;
  groundTemperature?: GroundTemperature;
  applicableMtowKg?: number;
  basketMaximumLoadKg?: number;
  configurationLimitsConfirmed?: boolean;
};

export type LoadCalculationResult =
  | {
      status: "AVAILABLE";
      permittedTotalMassKg: number;
      actualTotalMassKg: number;
      marginKg: number;
      availableOccupantsCapacityKg: number;
      performanceLimitedMassKg: number;
      limitingRule: string;
      calculationStatus: Extract<ManufacturerCalculationStatus, "OFFICIAL_VALIDATED" | "CANDIDATE_PILOT_VALIDATION">;
      manufacturerMethodId: string;
      modelParameterSetId: string;
      manufacturer: string;
      model: string;
      datasetId: string;
      manualRevision: string;
      launchElevationMslM: number;
      maximumAltitudeMslM: number;
      limitingAltitudeMslM: number;
      groundTemperatureC: number;
      groundTemperatureSource: string;
      manufacturerTemperatureMethod: string;
      calculatedAt: string;
    }
  | {
      status: "UNAVAILABLE";
      reasonCode: LoadUnavailableReasonCode;
      message: string;
    };

export type LoadSupportResult =
  | { supported: true; datasetId: string }
  | {
      supported: false;
      reasonCode: Extract<
        LoadUnavailableReasonCode,
        | "UNSUPPORTED_MODEL"
        | "UNSUPPORTED_OFFICIAL_DATASET"
        | "CONFIGURATION_LIMIT_MISSING"
      >;
      message: string;
    };

export interface ManufacturerLoadAdapter {
  readonly manufacturer: string;
  canCalculate(input: LoadCalculationInput): LoadSupportResult;
  calculate(input: LoadCalculationInput): LoadCalculationResult;
}

export type ElevationResult = {
  elevationMslM: number;
  source: string;
  fetchedAt: string;
};

export interface ElevationProvider {
  getElevation(input: {
    latitude: number;
    longitude: number;
  }): Promise<ElevationResult>;
}

export interface GroundTemperatureProvider {
  getGroundTemperature(input: {
    latitude: number;
    longitude: number;
    dateTime: string;
    weatherModel: string;
  }): Promise<GroundTemperature & { fetchedAt: string }>;
}

export type DemoLoadCalculationResult =
  | {
      status: "AVAILABLE";
      calculationMode: "DEMO";
      permittedTotalMassKg: number;
      actualTotalMassKg: number;
      marginKg: number;
      groundTemperatureC: number;
      launchElevationMslM: number;
      plannedMaximumAltitudeMslM: number;
      datasetId: "DEMO_CAMERON_Z105_UI_TEST";
    }
  | Extract<LoadCalculationResult, { status: "UNAVAILABLE" }>;
