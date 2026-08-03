import { CAMERON_Z105_ACTIVATION_REQUIREMENTS, cameronZ105References } from "../referenceCases/cameronZ105References.ts";

/**
 * Réceptacle auditable du futur dataset Cameron Z105.
 * Les champs numériques restent volontairement absents jusqu'à transcription et double vérification.
 */
export const cameronZ105Official = Object.freeze({
  id: "CAMERON_Z105_OFFICIAL",
  manufacturer: "Cameron",
  model: "Z105",
  authorityStatus: "PENDING_VERIFICATION",
  pilotValidationStatus: "CANDIDATE_PILOT_VALIDATION",
  enabled: false,
  manual: {
    title: "Hot Air Balloon Flight Manual",
    edition: "Issue 10",
    revision: "Amendment 18",
    amendment: "18",
    revisionDate: "2022-07-05",
    sourceUrl: "https://www.cameronballoons.co.uk/c/download/Hot-Air-Balloon-Flight-Manual-Amendment-18.pdf",
    checksum: "a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572",
  },
  supportedModels: ["Z105"],
  applicability: { model: "Z105", exactVolumeM3: 2_974 },
  originalUnits: { altitude: "m", temperature: "°C", pressure: "hPa", volume: "m³", mass: "kg" },
  axes: { groundTemperatureC: true, launchElevationMslM: true, plannedMaximumAltitudeMslM: true },
  documentedData: {
    loadTable: null,
    liftFormula: "HABFM_APPENDIX_2_A2_1",
    applicableConfigurations: { model: "Z105", volumeM3: 2_974 },
    mtomRules: "MIN_PERFORMANCE_AND_AIRCRAFT_MTOM",
  },
  source: {
    manualTitle: "Hot Air Balloon Flight Manual",
    manualRevision: "Issue 10 Amendment 18",
    sourceUrl: "https://www.cameronballoons.co.uk/c/download/Hot-Air-Balloon-Flight-Manual-Amendment-18.pdf",
    tablePages: ["5-1", "5-2", "5-3", "5-4", "A2-1"] as readonly string[],
    sourceFingerprint: "sha256:a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572",
  },
  calculationMethod: {
    temperatureRule: "GROUND_TEMPERATURE_WITH_MANUAL_ISA_LAPSE_RATE",
    altitudeRule: "MAXIMUM_PLANNED_ALTITUDE_AMSL_FROM_APPENDIX_2",
    interpolationPolicy: "DIRECT_FORMULA_NO_TABLE_INTERPOLATION",
    extrapolationAllowed: false,
    toleranceKg: null,
  },
  verification: {
    status: "PENDING_HUMAN_VERIFICATION",
    requiredReviewers: 2,
    verifiedBy: [] as readonly string[],
  },
  limitations: [
    "La formule officielle est transcrite mais attend une seconde vérification humaine.",
    "Quatorze cas supplémentaires sont nécessaires pour valider la méthode commune A2 ; le paramétrage Z105 reste validé séparément.",
    "Le moteur officiel doit rester indisponible.",
  ],
  referenceCaseIds: cameronZ105References.map(({ id }) => id),
  activationRequirements: CAMERON_Z105_ACTIVATION_REQUIREMENTS,
});
