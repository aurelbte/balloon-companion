import { calculateBalloonEmptyWeight, type Balloon } from "../balloons.ts";
import type { GroundTemperature, LoadCalculationInput } from "./types.ts";

/** Source unique du poids équipé pour le futur moteur de charge. */
export function balloonEquipmentWeightForLoad(balloon: Balloon): number | null {
  return calculateBalloonEmptyWeight(balloon);
}

/** Mapping unique utilisé par l'analyse et les tests d'intégration du moteur. */
export function buildLoadCalculationInput(input: Readonly<{
  balloon?: Balloon;
  occupantsWeightKg?: number;
  launchLatitude?: number;
  launchLongitude?: number;
  launchElevationMslM?: number;
  launchDateTime?: string;
  plannedMaximumAltitudeMslM?: number;
  groundTemperature?: GroundTemperature;
}>): LoadCalculationInput {
  const equipmentWeight = input.balloon ? balloonEquipmentWeightForLoad(input.balloon) : null;
  return {
    ...(input.balloon ? {
      balloonId: input.balloon.id,
      manufacturer: input.balloon.manufacturer,
      model: input.balloon.model,
      volumeM3: input.balloon.volumeM3,
      applicableMtowKg: input.balloon.applicableMtowKg,
      configurationLimitsConfirmed: input.balloon.configurationLimitsConfirmed,
      balloonEquipmentWeightKg: equipmentWeight ?? undefined,
    } : {}),
    occupantsWeightKg: input.occupantsWeightKg,
    launchLatitude: input.launchLatitude,
    launchLongitude: input.launchLongitude,
    launchElevationMslM: input.launchElevationMslM,
    launchDateTime: input.launchDateTime,
    plannedMaximumAltitudeMslM: input.plannedMaximumAltitudeMslM,
    groundTemperature: input.groundTemperature,
  };
}
