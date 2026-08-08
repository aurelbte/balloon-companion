import { calculateCameronMethodA2Candidate } from "./cameron/officialCalculation.ts";
import { enabledPilotValidationLoadConfigurations } from "./modelParameters/activationRegistry.ts";
import { cameronModelParameters } from "./modelParameters/cameronModels.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./types.ts";

export const CAMERON_CATALOG_VOLUME_TOLERANCE_M3 = 1;

const unavailable = (
  reasonCode: Extract<LoadCalculationResult, { status: "UNAVAILABLE" }>['reasonCode'],
  message: string,
): LoadCalculationResult => ({ status: "UNAVAILABLE", reasonCode, message });

export function normalizeLoadIdentifier(value: string | undefined): string {
  return value?.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ?? "";
}

export function calculatePilotValidationLoad(input: LoadCalculationInput): LoadCalculationResult {
  const manufacturer = normalizeLoadIdentifier(input.manufacturer);
  const model = normalizeLoadIdentifier(input.model);
  if (manufacturer !== "CAMERON") return unavailable("UNSUPPORTED_MODEL", "Constructeur non pris en charge.");

  const knownCameronModel = cameronModelParameters.find(
    (parameters) => normalizeLoadIdentifier(parameters.model) === model,
  );
  if (!knownCameronModel) return unavailable("UNSUPPORTED_MODEL", "Modèle non pris en charge.");

  const activation = enabledPilotValidationLoadConfigurations.find(
    (configuration) => configuration.manufacturerMethodId === knownCameronModel.manufacturerMethodId
      && configuration.modelParameterSetId === knownCameronModel.id
      && configuration.manualRevision === knownCameronModel.source.manualRevision,
  );
  if (!activation) return unavailable("PENDING_VERIFICATION", "Paramètres constructeur en attente de validation.");
  if (input.configurationLimitsConfirmed !== true) return unavailable("CONFIGURATION_LIMITS_UNCONFIRMED", "Confirmez les limites du ballon dans sa fiche.");
  if (!(typeof input.applicableMtowKg === "number" && Number.isFinite(input.applicableMtowKg) && input.applicableMtowKg > 0)) return unavailable("MISSING_MTOW", "MTOM non renseignée.");
  if (!(typeof input.volumeM3 === "number" && Number.isFinite(input.volumeM3))) return unavailable("VOLUME_MISMATCH", "Le volume enregistré ne correspond pas au modèle Cameron.");
  if (Math.abs(input.volumeM3 - (knownCameronModel.volumeM3 ?? Number.NaN)) > CAMERON_CATALOG_VOLUME_TOLERANCE_M3) {
    return unavailable("VOLUME_MISMATCH", "Le volume enregistré ne correspond pas au modèle Cameron.");
  }

  const calculation = calculateCameronMethodA2Candidate(
    { ...input, model: knownCameronModel.model, volumeM3: knownCameronModel.volumeM3 },
    knownCameronModel,
  );
  if (!calculation) return unavailable("OUTSIDE_OFFICIAL_TABLE", "Conditions hors domaine de la méthode.");
  const availableOccupantsCapacityKg = calculation.permittedTotalMassKg - input.balloonEquipmentWeightKg!;
  return {
    status: "AVAILABLE",
    calculationStatus: "CANDIDATE_PILOT_VALIDATION",
    permittedTotalMassKg: calculation.permittedTotalMassKg,
    performanceLimitedMassKg: calculation.performanceLimitedMassKg,
    actualTotalMassKg: calculation.actualTotalMassKg,
    availableOccupantsCapacityKg,
    marginKg: calculation.marginKg,
    limitingRule: calculation.limitingRule,
    manufacturer: "Cameron",
    model: knownCameronModel.model.replace("Z-", "Z"),
    datasetId: `${knownCameronModel.id}_PILOT_VALIDATION`,
    manufacturerMethodId: knownCameronModel.manufacturerMethodId,
    modelParameterSetId: knownCameronModel.id,
    manualRevision: knownCameronModel.source.manualRevision,
    launchElevationMslM: input.launchElevationMslM!,
    maximumAltitudeMslM: input.plannedMaximumAltitudeMslM!,
    limitingAltitudeMslM: input.plannedMaximumAltitudeMslM!,
    groundTemperatureC: input.groundTemperature!.temperatureC,
    groundTemperatureSource: input.groundTemperature!.provider ?? input.groundTemperature!.sourceModel,
    manufacturerTemperatureMethod: "GROUND_TEMPERATURE_WITH_MANUAL_ISA_LAPSE_RATE",
    calculatedAt: new Date().toISOString(),
  };
}
