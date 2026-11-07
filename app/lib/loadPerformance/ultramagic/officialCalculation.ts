import type { LoadModelParameterSet } from "../modelParameters/types.ts";
import { evaluateFm04Evidence, type Fm04VerificationReason, type UltramagicCandidateInput } from "./fm04Validation.ts";
import {
  calculateFm04LiftKgPer1000Ft3,
  FM04_CUBIC_METRES_PER_1000_CUBIC_FEET,
} from "./fm04Lift.ts";

export const ULTRAMAGIC_FM04_PENDING_REASON =
  "Paramètres Ultramagic en attente de validation avant activation produit.";

export type UltramagicValidationReason = Fm04VerificationReason
  | "METHOD_NOT_VALIDATED" | "MODEL_MISMATCH" | "INVALID_OR_MISSING_INPUT" | "OUTSIDE_METHOD_DOMAIN"
  | "MTOM_EXCEEDS_MANUFACTURER_LIMIT" | "CONFIGURATION_LIMITS_UNCONFIRMED" | "VOLUME_MISMATCH" | "PENDING_VERIFICATION";

/** Diagnostics only: no admissible mass, occupants capacity or margin is exposed. */
export type UltramagicLoadCandidateCalculation = Readonly<{
  status: "NON_VALIDÉ";
  reasons: readonly UltramagicValidationReason[];
  message: string;
  theoretical?: Readonly<{
    liftKgPer1000Ft3: number;
    performanceLimitedMassKg: number;
    manufacturerMtomCeilingKg: number;
    candidateMassCeilingKg: number;
    actualTotalMassKg: number;
  }>;
}>;

export function unvalidatedUltramagicLoad(
  reasons: readonly UltramagicValidationReason[], message: string,
): UltramagicLoadCandidateCalculation {
  return { status: "NON_VALIDÉ", reasons, message };
}

/** Internal candidate only. Documentary checks never activate the lift method. */
export function calculateUltramagicLoadCandidate(
  input: UltramagicCandidateInput,
  modelParameters: LoadModelParameterSet,
): UltramagicLoadCandidateCalculation {
  const normalizedInputModel = input.model?.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const normalizedParameterModel = modelParameters.model.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const groundTemperatureC = input.groundTemperature?.temperatureC;
  const values = [
    modelParameters.volumeM3, modelParameters.standardMtomKg, input.applicableMtowKg,
    input.balloonEquipmentWeightKg, input.occupantsWeightKg,
    input.launchElevationMslM, input.plannedMaximumAltitudeMslM, groundTemperatureC,
  ];
  if (modelParameters.manufacturer !== "Ultramagic" || normalizedInputModel !== normalizedParameterModel) {
    return unvalidatedUltramagicLoad(["MODEL_MISMATCH"], "Modèle Ultramagic incompatible avec les paramètres constructeur.");
  }
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))
    || modelParameters.volumeM3! <= 0 || modelParameters.standardMtomKg! <= 0
    || input.applicableMtowKg! <= 0 || input.balloonEquipmentWeightKg! <= 0 || input.occupantsWeightKg! < 0) {
    return unvalidatedUltramagicLoad(["INVALID_OR_MISSING_INPUT"], "Données de calcul manquantes ou invalides.");
  }
  if (input.applicableMtowKg! > modelParameters.standardMtomKg!) {
    return unvalidatedUltramagicLoad(["MTOM_EXCEEDS_MANUFACTURER_LIMIT"], "La MTOM saisie dépasse le plafond constructeur du modèle ; calcul refusé.");
  }
  const liftKgPer1000Ft3 = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: groundTemperatureC!,
    launchElevationMslM: input.launchElevationMslM!,
    maximumAltitudeMslM: input.plannedMaximumAltitudeMslM!,
  });
  if (liftKgPer1000Ft3 === null) {
    return unvalidatedUltramagicLoad(["OUTSIDE_METHOD_DOMAIN"], "Conditions hors du graphique FM04 p.5.3 Rev.23, ou construction hors de sa fenêtre de lecture.");
  }
  const performanceLimitedMassKg = liftKgPer1000Ft3
    * modelParameters.volumeM3! / FM04_CUBIC_METRES_PER_1000_CUBIC_FEET;
  const manufacturerMtomCeilingKg = modelParameters.standardMtomKg!;
  const verification = evaluateFm04Evidence(input);
  const actualTotalMassKg = verification.takeoffMassKg ?? (input.balloonEquipmentWeightKg! + input.occupantsWeightKg!);
  if (!Number.isFinite(performanceLimitedMassKg) || !Number.isFinite(actualTotalMassKg)) {
    return unvalidatedUltramagicLoad(["INVALID_OR_MISSING_INPUT"], "Résultat numérique non exploitable.");
  }
  const reasons: UltramagicValidationReason[] = [...verification.reasons, "METHOD_NOT_VALIDATED"];
  if (input.configurationLimitsConfirmed !== true) reasons.push("CONFIGURATION_LIMITS_UNCONFIRMED");
  if (input.applicableMtowKg! < manufacturerMtomCeilingKg) {
    const approval = verification.reducedMtomApproval;
    if (!approval || typeof approval.logbookReference !== "string" || !approval.logbookReference.trim() || approval.mtomKg !== input.applicableMtowKg) reasons.push("REDUCED_MTOM_DOCUMENTATION_UNVERIFIED");
  }
  return {
    ...unvalidatedUltramagicLoad(reasons, `NON_VALIDÉ : ${reasons.join(", ")}. Formule analytique et précision constructeur non démontrées par les deux exemples H65 ; aucune marge admissible.`),
    theoretical: {
      liftKgPer1000Ft3, performanceLimitedMassKg, manufacturerMtomCeilingKg,
      // The entered value is never replaced with the documentary reduced MTOM.
      candidateMassCeilingKg: Math.min(performanceLimitedMassKg, manufacturerMtomCeilingKg, input.applicableMtowKg!, verification.buildStandardMassCeilingKg ?? Infinity),
      actualTotalMassKg,
    },
  };
}
