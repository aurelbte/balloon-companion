import { calculateBalloonEmptyWeight, type Balloon } from "../balloons.ts";

/** Source unique du poids équipé pour le futur moteur de charge. */
export function balloonEquipmentWeightForLoad(balloon: Balloon): number | null {
  return calculateBalloonEmptyWeight(balloon);
}
