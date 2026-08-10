import {
  calculateCameronMethodA2Candidate,
  type CameronOfficialCalculation,
} from "./cameron/officialCalculation.ts";
import { normalizeLoadIdentifier } from "./candidateEngine.ts";
import { resolveCameronModelParameters } from "./modelParameters/cameronModels.ts";
import { ultramagicModelParameters } from "./modelParameters/ultramagicModels.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./types.ts";
import { calculateUltramagicLoadCandidate } from "./ultramagic/officialCalculation.ts";
import { findExactKubicekModel } from "./modelParameters/kubicekModels.ts";
import { calculateKubicekLoadCandidate } from "./kubicek/officialCalculation.ts";

export type UnsupportedLoadManufacturer = Readonly<{
  status: "UNSUPPORTED_MANUFACTURER";
  manufacturer: string;
}>;

export type ManufacturerLoadDispatchResult =
  | CameronOfficialCalculation
  | LoadCalculationResult
  | UnsupportedLoadManufacturer
  | null;

/** Délègue sans modifier les entrées ni les calculs propres au constructeur. */
export function calculateManufacturerLoad(
  manufacturer: string,
  model: string,
  inputs: LoadCalculationInput,
): ManufacturerLoadDispatchResult {
  const normalizedManufacturer = normalizeLoadIdentifier(manufacturer);
  if (normalizedManufacturer === "CAMERON") {
    const parameters = resolveCameronModelParameters(model);
    if (!parameters) return null;
    return calculateCameronMethodA2Candidate(
      { ...inputs, manufacturer, model },
      parameters,
    );
  }
  if (normalizedManufacturer === "ULTRAMAGIC") {
    const normalizedModel = normalizeLoadIdentifier(model);
    const parameters = ultramagicModelParameters.find(
      (entry) => normalizeLoadIdentifier(entry.model) === normalizedModel,
    );
    if (!parameters) return null;
    if (parameters.verificationStatus !== "CANDIDATE_PILOT_VALIDATION") {
      return {
        status: "UNAVAILABLE",
        reasonCode: "PENDING_VERIFICATION",
        message: "Paramètres Ultramagic en attente de validation avant activation produit.",
      };
    }
    if (inputs.configurationLimitsConfirmed !== true) {
      return {
        status: "UNAVAILABLE",
        reasonCode: "CONFIGURATION_LIMITS_UNCONFIRMED",
        message: "Confirmez les limites du ballon dans sa fiche.",
      };
    }
    if (!(typeof inputs.volumeM3 === "number" && Number.isFinite(inputs.volumeM3))
      || Math.abs(inputs.volumeM3 - (parameters.volumeM3 ?? Number.NaN)) > 1) {
      return {
        status: "UNAVAILABLE",
        reasonCode: "VOLUME_MISMATCH",
        message: "Le volume enregistré ne correspond pas au modèle Ultramagic.",
      };
    }
    const calculation = calculateUltramagicLoadCandidate(
      { ...inputs, manufacturer, model },
      parameters,
    );
    if (!calculation) return null;
    return {
      status: "AVAILABLE",
      calculationStatus: "CANDIDATE_PILOT_VALIDATION",
      ...calculation,
      manufacturer: "Ultramagic",
      model: parameters.model,
      datasetId: `${parameters.id}_PILOT_VALIDATION`,
      manufacturerMethodId: parameters.manufacturerMethodId,
      modelParameterSetId: parameters.id,
      manualRevision: parameters.source.manualRevision,
      launchElevationMslM: inputs.launchElevationMslM!,
      maximumAltitudeMslM: inputs.plannedMaximumAltitudeMslM!,
      limitingAltitudeMslM: inputs.plannedMaximumAltitudeMslM!,
      groundTemperatureC: inputs.groundTemperature!.temperatureC,
      groundTemperatureSource: inputs.groundTemperature!.provider ?? inputs.groundTemperature!.sourceModel,
      manufacturerTemperatureMethod: "GROUND_TEMPERATURE_WITH_ISA_PARALLEL",
      calculatedAt: new Date().toISOString(),
    };
  }
  if (normalizedManufacturer === "KUBICEK") {
    const parameters = findExactKubicekModel(model);
    if (!parameters) return null;
    return calculateKubicekLoadCandidate({ ...inputs, manufacturer, model }, parameters);
  }
  return { status: "UNSUPPORTED_MANUFACTURER", manufacturer };
}
