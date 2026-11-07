import { normalizeLoadIdentifier } from "./candidateEngine.ts";
import { calculateManufacturerLoad } from "./manufacturerDispatcher.ts";
import { findExactKubicekModel } from "./modelParameters/kubicekModels.ts";
import { ultramagicModelParameters } from "./modelParameters/ultramagicModels.ts";
import { enabledOfficialLoadParameterCombinations } from "./modelParameters/activationRegistry.ts";
import { canActivateOfficialLoadCandidate, type LoadModelParameterSet, type OfficialLoadActivationCandidate } from "./modelParameters/types.ts";
import type { KubicekEvidence } from "./kubicek/validation.ts";
import type { UltramagicFm04Evidence } from "./ultramagic/fm04Validation.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./types.ts";

/** Internal evidence contract only: no implicit conversion from a UI confirmation. */
export type ManufacturerEvidenceInput = LoadCalculationInput & {
  kubicekEvidence?: KubicekEvidence;
  fm04Evidence?: UltramagicFm04Evidence;
};

/** A registry entry is never itself proof of the real aircraft configuration. */
export function matchesValidatedManufacturerActivation(
  parameters: LoadModelParameterSet,
  activation: OfficialLoadActivationCandidate,
): boolean {
  return parameters.verificationStatus === "VERIFIED_FROM_OFFICIAL_MANUAL"
    && activation.key.modelParameterSetId === parameters.id
    && activation.key.manufacturerMethodId === parameters.manufacturerMethodId
    && activation.key.manualRevision === parameters.source.manualRevision
    && canActivateOfficialLoadCandidate(activation);
}

const blocked = (reasonCode: Extract<LoadCalculationResult, { status: "UNAVAILABLE" }>["reasonCode"], message: string): LoadCalculationResult => ({ status: "UNAVAILABLE", reasonCode, message });

/** null leaves the existing Cameron/other-manufacturer path strictly unchanged.
 * No caller-supplied registry, activation flag or evidence can activate a method.
 */
export function routeValidatedManufacturerLoad(input: ManufacturerEvidenceInput): LoadCalculationResult | null {
  const manufacturer = normalizeLoadIdentifier(input.manufacturer);
  if (manufacturer !== "ULTRAMAGIC" && manufacturer !== "KUBICEK") return null;
  const parameters = manufacturer === "KUBICEK"
    ? findExactKubicekModel(input.model ?? "")
    : ultramagicModelParameters.find((entry) => normalizeLoadIdentifier(entry.model) === normalizeLoadIdentifier(input.model));
  if (!parameters) return blocked("UNSUPPORTED_MODEL", "Modèle exact absent du registre constructeur ; aucun calcul admissible.");

  // Always execute the manufacturer's own documentary/safety checks. A validated
  // method/model/revision could never bypass a missing real-aircraft proof.
  const diagnostic = calculateManufacturerLoad(parameters.manufacturer, parameters.model, input);
  if (diagnostic && "status" in diagnostic && diagnostic.status === "UNAVAILABLE") return diagnostic;
  if (!diagnostic || !("status" in diagnostic)) return blocked("PENDING_VERIFICATION", "NON_VALIDÉ : résultat constructeur inexploitable.");
  const activated = enabledOfficialLoadParameterCombinations.some((entry) => matchesValidatedManufacturerActivation(parameters, entry));
  if (diagnostic.status === "NON_VALIDÉ") {
    return blocked("PENDING_VERIFICATION", `${parameters.manufacturer} ${parameters.model} · ${parameters.source.manualRevision} · Calcul constructeur non activé. ${diagnostic.message} Motifs : ${diagnostic.reasons.join(", ")}.`);
  }
  if (!activated) return blocked("PENDING_VERIFICATION", `NON_VALIDÉ : aucune activation validée pour ${parameters.manufacturerMethodId} / ${parameters.id} / ${parameters.source.manualRevision}.`);
  // Prepared for a future validated adapter, but candidates cannot be relabelled
  // OFFICIAL_VALIDATED here. They must themselves implement every aircraft guard.
  if (diagnostic.status !== "AVAILABLE" || diagnostic.calculationStatus !== "OFFICIAL_VALIDATED"
    || diagnostic.modelParameterSetId !== parameters.id || diagnostic.manufacturerMethodId !== parameters.manufacturerMethodId
    || diagnostic.manualRevision !== parameters.source.manualRevision || input.configurationLimitsConfirmed !== true) {
    return blocked("PENDING_VERIFICATION", "NON_VALIDÉ : calcul constructeur ou configuration réelle non validés malgré l'entrée d'activation.");
  }
  return diagnostic;
}
