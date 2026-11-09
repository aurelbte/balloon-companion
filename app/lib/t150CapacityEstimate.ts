import { calculateBalloonWeight, type BalloonWeights } from "./balloons.ts";
import { normalizeLoadIdentifier } from "./loadPerformance/candidateEngine.ts";
import { calculateManufacturerLoad } from "./loadPerformance/manufacturerDispatcher.ts";
import { fm04MinimumTom } from "./loadPerformance/ultramagic/fm04Rules.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import type { LoadCalculationInput } from "./loadPerformance/types.ts";

/** Provisional numeric inputs, NOT an fm04Evidence record or aircraft approval. */
export type T150CapacityConfiguration = {
  basketPlateKg?: number;
  basketCarriedKg?: number;
  buildMtomKg?: number;
  buildLmaxKg?: number;
  landingMassKg?: number;
  reducedMtomDocumented?: boolean;
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
  warnings: string[];
};
const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative = (value: number | undefined): value is number => finite(value) && value >= 0;
const positive = (value: number | undefined): value is number => finite(value) && value > 0;

/** Arithmetic diagnostic only; no configuration or method approval is implied. */
export function t150TheoreticalMarginKg(liftKg: number | null, mtomKg: number | undefined, equipmentKg: number | undefined, occupantsKg: number | undefined): number | null {
  if (liftKg === null || !positive(liftKg) || !positive(mtomKg) || !positive(equipmentKg) || !nonnegative(occupantsKg)) return null;
  const margin = Math.min(liftKg, mtomKg) - (equipmentKg + occupantsKg);
  return Number.isFinite(margin) ? margin : null;
}

/** /map T150 only. Reuses the existing candidate lift; never changes official routing or evidence. */
export function estimateT150RemainingCapacity(input: LoadCalculationInput, weights: BalloonWeights, configuration: T150CapacityConfiguration = {}): T150CapacityEstimate | null {
  if (normalizeLoadIdentifier(input.manufacturer) !== "ULTRAMAGIC" || normalizeLoadIdentifier(input.model) !== "T150") return null;
  const minimum = fm04MinimumTom("T150");
  if (minimum?.state !== "NUMERIC") throw new Error("Minimum TOM T150 absent des règles FM04.");
  const result: T150CapacityEstimate = { status: "ESTIMATION_NON_VALIDEE", methodReason: "METHOD_NOT_VALIDATED", theoreticalLiftKg: null, actualTotalMassKg: null, minimumTomKg: minimum.kg, remainingKg: null, limitingConstraint: null, headrooms: [], issues: [], warnings: ["Compatibilité réglementaire non justifiée : équipements multimarques acceptés pour l’estimation des masses uniquement.", "FDS, évents de rotation, équipements et suppléments applicables restent à vérifier."] };
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
  if (!positive(input.balloonEquipmentWeightKg)) result.issues.push("Masse du ballon équipé manquante ou invalide : marge théorique indisponible.");
  if (!nonnegative(input.occupantsWeightKg)) result.issues.push("Masse réelle pilote et passagers manquante ou invalide.");
  // Main-panel estimate: profile equipment (including full cylinders) plus occupants only.
  // No implicit bag/accessory mass or assumed landing mass is introduced.
  if (positive(input.balloonEquipmentWeightKg) && nonnegative(input.occupantsWeightKg)) {
    const total = input.balloonEquipmentWeightKg + input.occupantsWeightKg;
    if (Number.isFinite(total)) result.actualTotalMassKg = total;
    else result.issues.push("Somme des masses non exploitable.");
  }
  const documentaryLimits = [
    [configuration.buildMtomKg, "MTOM Build Standard"],
    [configuration.buildLmaxKg, "Lmax Build Standard"],
  ] as const;
  for (const [value, label] of documentaryLimits) {
    if (value === undefined) result.warnings.push(`${label} non documentée : limite non vérifiée pour cette estimation.`);
    else if (!positive(value)) result.issues.push(`${label} invalide.`);
  }
  const basketPlateKg = configuration.basketPlateKg ?? input.basketMaximumLoadKg;
  if (basketPlateKg === undefined) result.warnings.push("Plaque nacelle non documentée : limite non vérifiée pour cette estimation.");
  else if (!positive(basketPlateKg)) result.issues.push("Limite de plaque nacelle invalide.");
  if (configuration.basketCarriedKg !== undefined && !nonnegative(configuration.basketCarriedKg)) result.issues.push("Masse portée par la nacelle invalide.");
  if (configuration.landingMassKg === undefined) result.warnings.push(`Minimum TOM à l’atterrissage non vérifié (${minimum.kg} kg) : masse prévue à l’atterrissage indisponible.`);
  else if (!nonnegative(configuration.landingMassKg)) result.issues.push("Masse prévue à l'atterrissage invalide.");
  if (positive(input.applicableMtowKg) && positive(configuration.buildMtomKg) && input.applicableMtowKg > configuration.buildMtomKg) result.issues.push("MTOM applicable supérieure à celle du Build Standard.");
  if (!positive(input.applicableMtowKg)) result.issues.push("MTOM applicable manquante ou invalide.");
  const standardMtomKg = ultramagicModelParameters.find(({ model }) => model === "T150")!.standardMtomKg!;
  if (positive(input.applicableMtowKg) && input.applicableMtowKg < standardMtomKg && configuration.reducedMtomDocumented !== true) result.warnings.push("MTOM réduite : approbation au carnet non justifiée ; la valeur saisie reste appliquée sans valider son approbation.");
  if (result.actualTotalMassKg !== null) {
    if (result.actualTotalMassKg < minimum.kg) result.issues.push(`Masse au décollage inférieure au minimum TOM de ${minimum.kg} kg.`);
    if (nonnegative(configuration.landingMassKg) && configuration.landingMassKg < minimum.kg) result.issues.push(`Masse à l'atterrissage inférieure au minimum de ${minimum.kg} kg.`);
    if (nonnegative(configuration.landingMassKg) && configuration.landingMassKg > result.actualTotalMassKg) result.issues.push("Masse à l'atterrissage supérieure à la masse au décollage : vérifier les saisies.");
    if (nonnegative(configuration.basketCarriedKg) && nonnegative(input.occupantsWeightKg) && positive(weights.envelopeKg) && positive(weights.basketKg)
      && (configuration.basketCarriedKg < input.occupantsWeightKg || configuration.basketCarriedKg > result.actualTotalMassKg - weights.envelopeKg - weights.basketKg + 1e-7)) result.issues.push("Masse portée par la nacelle incohérente avec les masses saisies.");
  }
  // Safety issues remain visible, but cannot hide a purely numeric diagnostic.
  // Missing indispensable numeric data still leaves the diagnostic unavailable.
  const margin = t150TheoreticalMarginKg(result.theoreticalLiftKg, input.applicableMtowKg, input.balloonEquipmentWeightKg, input.occupantsWeightKg);
  if (margin === null || result.theoreticalLiftKg === null || result.actualTotalMassKg === null) return result;
  const gross = result.actualTotalMassKg;
  result.headrooms = [
    { label: "Portance théorique", remainingKg: result.theoreticalLiftKg - gross },
    { label: "MTOM applicable", remainingKg: input.applicableMtowKg! - gross },
  ];
  for (const [value, label] of documentaryLimits) if (positive(value)) result.headrooms.push({ label, remainingKg: value - gross });
  if (positive(basketPlateKg) && (nonnegative(configuration.basketCarriedKg) || (positive(weights.envelopeKg) && positive(weights.basketKg)))) {
    // Conservative carried-mass upper bound: never ask to re-enter existing component masses.
    const carried = configuration.basketCarriedKg ?? gross - weights.envelopeKg! - weights.basketKg!;
    if (configuration.basketCarriedKg === undefined) result.warnings.push("Plaque nacelle : hypothèse conservatrice, toutes les masses hors enveloppe et nacelle vide sont comptées comme portées ; répartition réelle non justifiée.");
    result.headrooms.push({ label: "Plaque nacelle (hors nacelle vide)", remainingKg: basketPlateKg - carried });
  }
  if (input.configurationLimitsConfirmed !== true) result.warnings.push("Limites du profil non confirmées ; aucune charge admissible validée.");
  const limiting = result.headrooms.slice(0, 2).reduce((a, b) => b.remainingKg < a.remainingKg ? b : a);
  for (const check of result.headrooms.slice(2)) if (check.remainingKg < 0) result.warnings.push(`Limite dépassée : ${check.label} (${Math.floor(check.remainingKg)} kg). La marge portance/MTOM ne tient pas compte de cette restriction.`);
  result.remainingKg = margin;
  result.limitingConstraint = limiting.label;
  return result;
}
