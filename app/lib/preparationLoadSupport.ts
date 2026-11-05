import { normalizeLoadIdentifier } from "./loadPerformance/candidateEngine.ts";
import { cameronModelParameters } from "./loadPerformance/modelParameters/cameronModels.ts";
import { kubicekModelParameters } from "./loadPerformance/modelParameters/kubicekModels.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import { enabledPilotValidationLoadConfigurations } from "./loadPerformance/modelParameters/activationRegistry.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./loadPerformance/types.ts";

/** Presentation of actual production support; never activates a candidate method. */
export function describePreparationLoad(input: LoadCalculationInput, result: Pick<LoadCalculationResult, "status"> & { reasonCode?: string; message?: string }) {
  const parameters = [...cameronModelParameters, ...kubicekModelParameters, ...ultramagicModelParameters].find((item) => normalizeLoadIdentifier(item.manufacturer) === normalizeLoadIdentifier(input.manufacturer) && normalizeLoadIdentifier(item.model) === normalizeLoadIdentifier(input.model));
  const active = !!parameters && enabledPilotValidationLoadConfigurations.some((item) => item.modelParameterSetId === parameters.id && item.manufacturerMethodId === parameters.manufacturerMethodId && item.manualRevision === parameters.source.manualRevision);
  let message = result.status === "AVAILABLE" ? "Calcul disponible - conserver le statut constructeur indiqué dans le détail." : result.message ?? "Calcul indisponible.";
  if (result.status === "UNAVAILABLE" && result.reasonCode === "UNSUPPORTED_MODEL") {
    message = parameters && !active
      ? `${input.manufacturer} ${input.model} : données constructeur présentes (${parameters.source.manualRevision}), mais calcul non activé dans Prépa. La température ne débloque pas ce modèle.`
      : `${input.manufacturer || "Constructeur inconnu"} ${input.model || "modèle inconnu"} : aucun calcul pris en charge pour ce ballon dans Prépa. ${result.message ?? ""}`;
  }
  const inactiveCandidate = result.status === "UNAVAILABLE" && result.reasonCode === "UNSUPPORTED_MODEL" && parameters?.verificationStatus === "CANDIDATE_PILOT_VALIDATION" && !active;
  const reason = inactiveCandidate ? "Calcul constructeur non activé" : result.message ?? "Données manquantes.";
  return { message, reason, inactiveCandidate, parameterId: parameters?.id ?? null, methodId: parameters?.manufacturerMethodId ?? null, manualRevision: parameters?.source.manualRevision ?? null, parameterStatus: parameters?.verificationStatus ?? null, candidateEnabled: active };
}
