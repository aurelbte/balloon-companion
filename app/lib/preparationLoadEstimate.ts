import { normalizeLoadIdentifier } from "./loadPerformance/candidateEngine.ts";
import { calculateManufacturerLoad } from "./loadPerformance/manufacturerDispatcher.ts";
import type { ManufacturerEvidenceInput } from "./loadPerformance/validatedManufacturerRouting.ts";
import type { LoadCalculationResult } from "./loadPerformance/types.ts";

export const PREPARATION_LOAD_ESTIMATE_WARNING =
  "ESTIMATION NON VALIDÉE — ne pas utiliser pour déterminer la charge admissible";

type EstimateValue = Readonly<{ label: string; value: number; unit: "kg" | "kg/1000 ft³" | "LU" }>;
export type PreparationLoadEstimate = Readonly<{
  status: "NON_VALIDÉ";
  warning: typeof PREPARATION_LOAD_ESTIMATE_WARNING;
  reasonCodes: readonly string[];
  details: string;
}> & (
  | Readonly<{ kind: "VALUES"; values: readonly EstimateValue[]; admissibilityReasonCodes: readonly string[] }>
  | Readonly<{ kind: "REFUSAL"; reason: string }>
);

const reasonCopy: Readonly<Record<string, string>> = {
  INVALID_OR_MISSING_INPUT: "Données de calcul manquantes ou invalides.",
  OUTSIDE_METHOD_DOMAIN: "Conditions hors du domaine du graphique FM04 : estimation refusée.",
  MTOM_EXCEEDS_MANUFACTURER_LIMIT: "La MTOM saisie dépasse le plafond constructeur.",
  CONFIGURATION_LIMITS_UNCONFIRMED: "Configuration individuelle du ballon non confirmée.",
  BUILD_STANDARD_UNVERIFIED: "Build Standard du ballon non documenté ou non vérifié.",
  COMPLETE_MASSES_UNVERIFIED: "Masses complètes du ballon non documentées ou incohérentes.",
  MINIMUM_TOM_UNVERIFIED: "Minimum constructeur non documenté pour ce modèle.",
  LANDING_MASS_UNVERIFIED: "Masse à l’atterrissage non documentée.",
  BASKET_PLATE_UNVERIFIED: "Plaque de charge de la nacelle non vérifiée.",
  APPLICABLE_SUPPLEMENTS_UNVERIFIED: "Suppléments applicables non vérifiés.",
};

// These invalidate the existing candidate's numerical/model/domain calculation.
// Documentary/configuration reasons remain visible but cannot validate a load.
const theoreticalBlockers = new Set([
  "INVALID_OR_MISSING_INPUT", "INVALID_NUMERICAL_INPUT", "MODEL_MISMATCH",
  "MODEL_PARAMETERS_MISMATCH", "VOLUME_MISMATCH", "OUTSIDE_METHOD_DOMAIN",
  "MTOM_EXCEEDS_MANUFACTURER_LIMIT", "MTOW_INVALID", "PENDING_VERIFICATION",
]);

/** /map consultation only. Never changes official routing, activation or PDF data.
 * Uses the candidate's existing theoretical output, without substituting missing
 * masses/evidence. Individual admissibility checks remain in the official result;
 * their absence does not invalidate a numerically calculable theoretical result.
 * No ceilings, capacity or margins leak through this projection.
 */
export function describePreparationLoadEstimate(
  input: ManufacturerEvidenceInput,
  officialResult: Pick<LoadCalculationResult, "status"> & { reasonCode?: string; message?: string },
): PreparationLoadEstimate | null {
  const manufacturer = normalizeLoadIdentifier(input.manufacturer);
  if (manufacturer !== "ULTRAMAGIC" && manufacturer !== "KUBICEK") return null;
  const refuse = (reason: string, reasonCodes: readonly string[], details = reason): PreparationLoadEstimate => ({
    status: "NON_VALIDÉ", kind: "REFUSAL", warning: PREPARATION_LOAD_ESTIMATE_WARNING,
    reason, reasonCodes, details,
  });
  // Numeric inputs remain necessary to execute the existing engines. Individual
  // configuration approval is separate; no confirmation/evidence is fabricated.
  const documentaryRefusal = ["PENDING_VERIFICATION", "CONFIGURATION_LIMITS_UNCONFIRMED", "CONFIGURATION_LIMIT_MISSING"];
  if (officialResult.status === "UNAVAILABLE" && !documentaryRefusal.includes(officialResult.reasonCode ?? "")) {
    return refuse(officialResult.message ?? "Données de calcul insuffisantes.", [officialResult.reasonCode ?? "MISSING_INPUT"]);
  }
  const diagnostic = calculateManufacturerLoad(input.manufacturer ?? "", input.model ?? "", input);
  if (!diagnostic || !("status" in diagnostic) || diagnostic.status !== "NON_VALIDÉ") {
    return refuse("Aucun résultat théorique candidat exploitable pour ce modèle.", ["NO_CANDIDATE_RESULT"]);
  }
  const methodReason = manufacturer === "ULTRAMAGIC" ? "METHOD_NOT_VALIDATED" : "LU_METHOD_NOT_VALIDATED";
  const reasons: readonly string[] = diagnostic.reasons;
  const blockers = reasons.filter((code) => theoreticalBlockers.has(code));
  if (blockers.length) {
    const firstBlock = "blocks" in diagnostic ? diagnostic.blocks.find(({ code }) => blockers.includes(code)) : undefined;
    return refuse(firstBlock?.message ?? reasonCopy[blockers[0]] ?? "Configuration ou données constructeur insuffisantes : estimation refusée.",
      blockers, diagnostic.message);
  }
  const theoretical = diagnostic.theoretical;
  if (!reasons.includes(methodReason) || !theoretical) {
    return refuse("Le moteur ne fournit pas de résultat théorique candidat exploitable.", ["MISSING_THEORETICAL_RESULT"]);
  }
  const values: EstimateValue[] = [];
  if (manufacturer === "ULTRAMAGIC" && "liftKgPer1000Ft3" in theoretical) {
    values.push({ label: "Portance volumique théorique", value: theoretical.liftKgPer1000Ft3, unit: "kg/1000 ft³" });
  } else if (manufacturer === "KUBICEK" && "liftUnits" in theoretical) {
    values.push({ label: "Indice de portance théorique", value: theoretical.liftUnits, unit: "LU" });
  } else {
    return refuse("Unités du résultat candidat incohérentes avec le constructeur.", ["THEORETICAL_UNIT_MISMATCH"]);
  }
  values.push({ label: "Masse totale théorique issue de la portance", value: theoretical.performanceLimitedMassKg, unit: "kg" });
  if (!values.every(({ value }) => Number.isFinite(value) && value > 0)) {
    return refuse("Valeurs théoriques manquantes ou non exploitables.", ["INVALID_THEORETICAL_RESULT"]);
  }
  return { status: "NON_VALIDÉ", kind: "VALUES", warning: PREPARATION_LOAD_ESTIMATE_WARNING,
    reasonCodes: reasons, details: diagnostic.message, values,
    admissibilityReasonCodes: reasons.filter((code) => code !== methodReason) };
}
