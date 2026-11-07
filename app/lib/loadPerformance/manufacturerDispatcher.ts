import {
  calculateCameronMethodA2Candidate,
  type CameronOfficialCalculation,
} from "./cameron/officialCalculation.ts";
import { normalizeLoadIdentifier } from "./candidateEngine.ts";
import { resolveCameronModelParameters } from "./modelParameters/cameronModels.ts";
import { ultramagicModelParameters } from "./modelParameters/ultramagicModels.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./types.ts";
import { calculateUltramagicLoadCandidate, unvalidatedUltramagicLoad, type UltramagicLoadCandidateCalculation } from "./ultramagic/officialCalculation.ts";
import { findExactKubicekModel } from "./modelParameters/kubicekModels.ts";
import type { KubicekCandidateInput } from "./kubicek/validation.ts";
import { calculateKubicekLoadCandidate, type KubicekLoadCandidateCalculation } from "./kubicek/officialCalculation.ts";

export type UnsupportedLoadManufacturer = Readonly<{
  status: "UNSUPPORTED_MANUFACTURER";
  manufacturer: string;
}>;

export type ManufacturerLoadDispatchResult =
  | CameronOfficialCalculation
  | LoadCalculationResult
  | UnsupportedLoadManufacturer
  | KubicekLoadCandidateCalculation
  | UltramagicLoadCandidateCalculation
  | null;

/** Délègue sans modifier les entrées ni les calculs propres au constructeur. */
export function calculateManufacturerLoad(
  manufacturer: string,
  model: string,
  inputs: KubicekCandidateInput,
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
      return unvalidatedUltramagicLoad(["PENDING_VERIFICATION"], "Paramètres Ultramagic en attente de validation avant activation produit.");
    }
    if (!(typeof inputs.volumeM3 === "number" && Number.isFinite(inputs.volumeM3))
      || Math.abs(inputs.volumeM3 - (parameters.volumeM3 ?? Number.NaN)) > 1) {
      return unvalidatedUltramagicLoad(["VOLUME_MISMATCH"], "Le volume enregistré ne correspond pas au modèle Ultramagic.");
    }
    return calculateUltramagicLoadCandidate({ ...inputs, manufacturer, model }, parameters);
  }

  if (normalizedManufacturer === "KUBICEK") {
    const parameters = findExactKubicekModel(model);
    if (!parameters) return null;
    return calculateKubicekLoadCandidate({ ...inputs, manufacturer: inputs.manufacturer ?? manufacturer, model: inputs.model ?? model }, parameters);
  }
  return { status: "UNSUPPORTED_MANUFACTURER", manufacturer };
}
