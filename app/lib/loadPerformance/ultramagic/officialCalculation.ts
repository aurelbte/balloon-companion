import type { LoadModelParameterSet } from "../modelParameters/types.ts";
import type { LoadCalculationInput } from "../types.ts";
import {
  calculateFm04LiftKgPer1000Ft3,
  FM04_CUBIC_METRES_PER_1000_CUBIC_FEET,
} from "./fm04Lift.ts";

export const ULTRAMAGIC_FM04_PENDING_REASON =
  "Paramètres Ultramagic en attente de validation avant activation produit.";

export type UltramagicLoadCandidateCalculation = Readonly<{
  liftKgPer1000Ft3: number;
  performanceLimitedMassKg: number;
  permittedTotalMassKg: number;
  actualTotalMassKg: number;
  availableOccupantsCapacityKg: number;
  marginKg: number;
  limitingRule: "ULTRAMAGIC_LIFT" | "APPLICABLE_MTOW";
}>;

/** Calcul candidat interne uniquement ; il ne constitue pas une activation produit. */
export function calculateUltramagicLoadCandidate(
  input: LoadCalculationInput,
  modelParameters: LoadModelParameterSet,
): UltramagicLoadCandidateCalculation | null {
  const normalizedInputModel = input.model?.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const normalizedParameterModel = modelParameters.model.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const groundTemperatureC = input.groundTemperature?.temperatureC;
  const values = [
    modelParameters.volumeM3,
    modelParameters.standardMtomKg,
    input.applicableMtowKg,
    input.balloonEquipmentWeightKg,
    input.occupantsWeightKg,
    input.launchElevationMslM,
    input.plannedMaximumAltitudeMslM,
    groundTemperatureC,
  ];
  if (modelParameters.manufacturer !== "Ultramagic" || normalizedInputModel !== normalizedParameterModel) return null;
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  if (modelParameters.volumeM3! <= 0 || input.applicableMtowKg! <= 0 || input.balloonEquipmentWeightKg! <= 0 || input.occupantsWeightKg! < 0) return null;

  const liftKgPer1000Ft3 = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: groundTemperatureC!,
    launchElevationMslM: input.launchElevationMslM!,
    maximumAltitudeMslM: input.plannedMaximumAltitudeMslM!,
  });
  if (liftKgPer1000Ft3 === null) return null;

  const performanceLimitedMassKg = liftKgPer1000Ft3
    * modelParameters.volumeM3! / FM04_CUBIC_METRES_PER_1000_CUBIC_FEET;
  const permittedTotalMassKg = Math.min(performanceLimitedMassKg, input.applicableMtowKg!);
  const actualTotalMassKg = input.balloonEquipmentWeightKg! + input.occupantsWeightKg!;
  const availableOccupantsCapacityKg = permittedTotalMassKg - input.balloonEquipmentWeightKg!;
  return {
    liftKgPer1000Ft3,
    performanceLimitedMassKg,
    permittedTotalMassKg,
    actualTotalMassKg,
    availableOccupantsCapacityKg,
    marginKg: permittedTotalMassKg - actualTotalMassKg,
    limitingRule: input.applicableMtowKg! < performanceLimitedMassKg
      ? "APPLICABLE_MTOW"
      : "ULTRAMAGIC_LIFT",
  };
}
