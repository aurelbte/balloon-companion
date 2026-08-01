export type LoadUnavailableReasonCode =
  | "NO_BALLOON"
  | "INCOMPLETE_BALLOON_MASSES"
  | "NO_OCCUPANTS_WEIGHT"
  | "NO_MAXIMUM_ALTITUDE"
  | "NO_LAUNCH_ELEVATION"
  | "NO_TEMPERATURE_PROFILE"
  | "UNSUPPORTED_MODEL"
  | "UNSUPPORTED_OFFICIAL_DATASET"
  | "OUTSIDE_OFFICIAL_TABLE"
  | "MISSING_MTOW"
  | "CONFIGURATION_LIMIT_MISSING";

export type TemperatureProfilePoint = {
  altitudeMslM: number;
  temperatureC: number;
  sourceModel: string;
  forecastRun: string;
  validTime: string;
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
  temperatureProfile?: readonly TemperatureProfilePoint[];
  applicableMtowKg?: number;
  basketMaximumLoadKg?: number;
};

export type LoadCalculationResult =
  | {
      status: "AVAILABLE";
      permittedTotalMassKg: number;
      actualTotalMassKg: number;
      marginKg: number;
      limitingRule: string;
      manufacturer: string;
      model: string;
      datasetId: string;
      manualRevision: string;
      launchElevationMslM: number;
      maximumAltitudeMslM: number;
      limitingAltitudeMslM: number;
      limitingTemperatureC: number;
      weatherSource: string;
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

export interface LoadWeatherProvider {
  getTemperatureProfile(input: {
    latitude: number;
    longitude: number;
    launchDateTime: string;
    launchElevationMslM: number;
    plannedMaximumAltitudeMslM: number;
  }): Promise<readonly TemperatureProfilePoint[]>;
}
