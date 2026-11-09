import { calculateBalloonWeight, type BalloonWeights } from "./balloons.ts";
import { normalizeLoadIdentifier } from "./loadPerformance/candidateEngine.ts";
import { calculateManufacturerLoad } from "./loadPerformance/manufacturerDispatcher.ts";
import { fm04Compatibility, fm04MinimumTom } from "./loadPerformance/ultramagic/fm04Rules.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import type { LoadCalculationInput } from "./loadPerformance/types.ts";

/** Provisional numeric inputs, NOT an fm04Evidence record or aircraft approval. */
export type T150CapacityConfiguration = {
  basketType?: string;
  burnerModel?: string;
  basketPlateKg?: number;
  basketCarriedKg?: number;
  buildMtomKg?: number;
  buildLmaxKg?: number;
  baggageKg?: number;
  accessoriesKg?: number;
  landingMassKg?: number;
  reducedMtomDocumented?: boolean;
  equipmentRequirementsReviewed?: boolean;
};
export type T150CapacityEstimate = {
  status: "ESTIMATION_NON_VALIDEE";
  methodReason: "METHOD_NOT_VALIDATED";
  theoreticalLiftKg: number | null;
  actualTotalMassKg: number | null;
  minimumTomKg: number;
  remainingKg: number | null;
  limitingConstraint: string | null;
  headrooms: { label: string; remainingKg: number }[];
  issues: string[];
};
const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative = (value: number | undefined): value is number => finite(value) && value >= 0;
const positive = (value: number | undefined): value is number => finite(value) && value > 0;

/** /map T150 only. Reuses the existing candidate lift; never changes official routing or evidence. */
export function estimateT150RemainingCapacity(input: LoadCalculationInput, weights: BalloonWeights, configuration: T150CapacityConfiguration): T150CapacityEstimate | null {
  if (normalizeLoadIdentifier(input.manufacturer) !== "ULTRAMAGIC" || normalizeLoadIdentifier(input.model) !== "T150") return null;
  const minimum = fm04MinimumTom("T150");
  if (minimum?.state !== "NUMERIC") throw new Error("Minimum TOM T150 absent des règles FM04.");
  const result: T150CapacityEstimate = { status: "ESTIMATION_NON_VALIDEE", methodReason: "METHOD_NOT_VALIDATED", theoreticalLiftKg: null, actualTotalMassKg: null, minimumTomKg: minimum.kg, remainingKg: null, limitingConstraint: null, headrooms: [], issues: [] };
  const candidate = calculateManufacturerLoad(input.manufacturer!, input.model!, input);
  if (candidate && "status" in candidate && candidate.status === "NON_VALIDÉ" && "theoretical" in candidate && candidate.theoretical && "liftKgPer1000Ft3" in candidate.theoretical) {
    result.theoreticalLiftKg = candidate.theoretical.performanceLimitedMassKg;
  }
  if (result.theoreticalLiftKg === null || !Number.isFinite(result.theoreticalLiftKg) || result.theoreticalLiftKg <= 0) {
    result.theoreticalLiftKg = null;
    result.issues.push("Portance théorique indisponible : vérifier température, altitudes, volume et MTOM dans les données de préparation.");
  }
  const equipment = calculateBalloonWeight(weights);
  if (equipment === null || !Number.isFinite(equipment) || equipment !== input.balloonEquipmentWeightKg) result.issues.push("Masses réelles des composants manquantes ou incohérentes avec le ballon équipé.");
  if (weights.fullCylinders.length < 2 || weights.fullCylinders.some(({ fullWeightKg }) => !Number.isFinite(fullWeightKg) || fullWeightKg <= 0)) result.issues.push("Au moins deux cylindres avec leurs masses réelles carburant compris sont nécessaires (FM04 p.5.6).");
  if (!nonnegative(input.occupantsWeightKg)) result.issues.push("Masse réelle pilote et passagers manquante ou invalide.");
  if (!nonnegative(configuration.baggageKg)) result.issues.push("Masse des bagages manquante ou invalide (saisir 0 si aucun).");
  if (!nonnegative(configuration.accessoriesKg)) result.issues.push("Masse des accessoires manquante ou invalide (saisir 0 si aucun).");
  if (equipment !== null && Number.isFinite(equipment) && nonnegative(input.occupantsWeightKg) && nonnegative(configuration.baggageKg) && nonnegative(configuration.accessoriesKg)) {
    const total = equipment + input.occupantsWeightKg + configuration.baggageKg + configuration.accessoriesKg;
    if (Number.isFinite(total)) result.actualTotalMassKg = total;
    else result.issues.push("Somme des masses non exploitable.");
  }
  const compatible = fm04Compatibility("T150")!;
  if (!compatible.baskets.includes(normalizeLoadIdentifier(configuration.basketType))) result.issues.push("Type de nacelle absent ou incompatible avec T150 (FM04 p.5.6).");
  if (!compatible.burners.includes(normalizeLoadIdentifier(configuration.burnerModel))) result.issues.push("Brûleur ou assemblage absent ou incompatible avec T150 (FM04 p.5.6).");
  const numericFields = [
    [configuration.basketPlateKg, "Limite de la plaque nacelle"],
    [configuration.buildMtomKg, "MTOM du Build Standard"],
    [configuration.buildLmaxKg, "Lmax du Build Standard"],
  ] as const;
  for (const [value, label] of numericFields) if (!positive(value)) result.issues.push(`${label} manquante ou invalide.`);
  if (!nonnegative(configuration.basketCarriedKg)) result.issues.push("Masse portée par la nacelle manquante ou invalide (hors nacelle vide).");
  if (!nonnegative(configuration.landingMassKg)) result.issues.push("Masse prévue à l'atterrissage manquante ou invalide.");
  if (positive(input.applicableMtowKg) && positive(configuration.buildMtomKg) && input.applicableMtowKg > configuration.buildMtomKg) result.issues.push("MTOM applicable supérieure à celle du Build Standard.");
  if (!positive(input.applicableMtowKg)) result.issues.push("MTOM applicable manquante ou invalide.");
  if (!configuration.equipmentRequirementsReviewed) result.issues.push("Vérifier FDS, évents de rotation, équipements et suppléments applicables au Build Standard.");
  const standardMtomKg = ultramagicModelParameters.find(({ model }) => model === "T150")!.standardMtomKg!;
  if (positive(input.applicableMtowKg) && input.applicableMtowKg < standardMtomKg && configuration.reducedMtomDocumented !== true) result.issues.push("Confirmer l'inscription au carnet de la MTOM réduite utilisée ; aucune réduction automatique.");
  if (result.actualTotalMassKg !== null) {
    if (result.actualTotalMassKg < minimum.kg) result.issues.push(`Masse au décollage inférieure au minimum TOM de ${minimum.kg} kg.`);
    if (nonnegative(configuration.landingMassKg) && configuration.landingMassKg < minimum.kg) result.issues.push(`Masse à l'atterrissage inférieure au minimum de ${minimum.kg} kg.`);
    if (nonnegative(configuration.landingMassKg) && configuration.landingMassKg > result.actualTotalMassKg) result.issues.push("Masse à l'atterrissage supérieure à la masse au décollage : vérifier les saisies.");
    if (nonnegative(configuration.basketCarriedKg) && nonnegative(input.occupantsWeightKg) && positive(weights.envelopeKg) && positive(weights.basketKg)
      && (configuration.basketCarriedKg < input.occupantsWeightKg || configuration.basketCarriedKg > result.actualTotalMassKg - weights.envelopeKg - weights.basketKg + 1e-7)) result.issues.push("Masse portée par la nacelle incohérente avec les masses saisies.");
  }
  if (result.issues.length || result.theoreticalLiftKg === null || result.actualTotalMassKg === null) return result;
  const gross = result.actualTotalMassKg;
  result.headrooms = [
    { label: "Portance théorique", remainingKg: result.theoreticalLiftKg - gross },
    { label: "MTOM applicable", remainingKg: input.applicableMtowKg! - gross },
    { label: "MTOM Build Standard", remainingKg: configuration.buildMtomKg! - gross },
    { label: "Lmax Build Standard", remainingKg: configuration.buildLmaxKg! - gross },
    { label: "Plaque nacelle (hors nacelle vide)", remainingKg: configuration.basketPlateKg! - configuration.basketCarriedKg! },
  ];
  const limiting = result.headrooms.reduce((a, b) => b.remainingKg < a.remainingKg ? b : a);
  result.remainingKg = limiting.remainingKg;
  result.limitingConstraint = limiting.label;
  return result;
}
