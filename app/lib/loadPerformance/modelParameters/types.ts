export type LoadManufacturer = "Cameron" | "Kubíček" | "Ultramagic";

export type ModelParameterVerificationStatus =
  | "VERIFIED_FROM_OFFICIAL_MANUAL"
  | "PENDING_HUMAN_VERIFICATION"
  | "SUPPLEMENT_REQUIRED"
  | "CANDIDATE_PILOT_VALIDATION"
  | "PENDING_VERIFICATION";

export type ModelParameterSource = Readonly<{
  manualId: string;
  manualRevision: string;
  pages: readonly string[];
  supplementId?: string;
}>;

/**
 * A model parameter set identifies documented model data only. Aircraft-specific
 * MTOM/RMTOM, basket limits and approved configuration remain outside this registry.
 */
export type LoadModelParameterSet = Readonly<{
  id: string;
  manufacturer: LoadManufacturer;
  manufacturerModelId: string;
  model: string;
  manufacturerMethodId: string;
  volumeM3?: number;
  volumeCuFt?: number;
  standardMtomKg?: number;
  reducedMtomKg?: number;
  tableRowId?: string;
  maximumCalculationTemperatureC?: number;
  source: ModelParameterSource;
  verificationStatus: ModelParameterVerificationStatus;
  notes: readonly string[];
}>;

export type MethodValidationPlan = Readonly<{
  level: "METHOD";
  minimumCases: number;
  coverage: readonly string[];
}>;

export type FamilyValidationPlan = Readonly<{
  level: "FAMILY_OR_TABLE_ROW";
  minimumCases: number;
  coverage: readonly string[];
}>;

export type ModelValidationPlan = Readonly<{
  level: "MODEL_PARAMETER_SET";
  minimumCases: number;
  coverage: readonly string[];
}>;

export type OfficialLoadActivationKey = Readonly<{
  manufacturerMethodId: string;
  modelParameterSetId: string;
  manualRevision: string;
  configurationLimitsConfirmed: true;
}>;

export type OfficialLoadActivationCandidate = Readonly<{
  key: OfficialLoadActivationKey;
  methodValidated: boolean;
  modelParametersVerified: boolean;
  sourcesTraceable: boolean;
  targetedTestsPassing: boolean;
}>;

export function canActivateOfficialLoadCandidate(candidate: OfficialLoadActivationCandidate): boolean {
  return candidate.methodValidated
    && candidate.modelParametersVerified
    && candidate.sourcesTraceable
    && candidate.targetedTestsPassing
    && candidate.key.configurationLimitsConfirmed === true;
}
