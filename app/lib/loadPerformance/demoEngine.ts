import { demoCameronZ105 } from "./datasets/demoCameronZ105.ts";
import { interpolateDemoPermittedMass } from "./demoInterpolation.ts";
import type { DemoLoadCalculationResult, LoadCalculationInput } from "./types.ts";

export const DEMO_LOAD_BADGE = "TEST" as const;

const unavailable = (reasonCode: Extract<DemoLoadCalculationResult, { status: "UNAVAILABLE" }>['reasonCode'], message: string): DemoLoadCalculationResult => ({ status: "UNAVAILABLE", reasonCode, message });

export function calculateDemoLoad(input: LoadCalculationInput, demoAllowed: boolean): DemoLoadCalculationResult {
  if (!demoAllowed) return unavailable("UNSUPPORTED_OFFICIAL_DATASET", "Calcul de démonstration désactivé.");
  if (!input.balloonId || input.manufacturer !== "Cameron" || input.model !== "Z105") return unavailable("UNSUPPORTED_MODEL", "Le test UX est limité au Cameron Z105.");
  if (!(typeof input.balloonEquipmentWeightKg === "number" && input.balloonEquipmentWeightKg > 0)) return unavailable("INCOMPLETE_BALLOON_MASSES", "Complétez les masses du ballon.");
  if (!(typeof input.occupantsWeightKg === "number" && input.occupantsWeightKg >= 0)) return unavailable("NO_OCCUPANTS_WEIGHT", "Renseignez Pilote + passagers.");
  if (!(typeof input.plannedMaximumAltitudeMslM === "number" && Number.isFinite(input.plannedMaximumAltitudeMslM))) return unavailable("NO_MAXIMUM_ALTITUDE", "Altitude max requise");
  if (!(typeof input.launchElevationMslM === "number" && Number.isFinite(input.launchElevationMslM))) return unavailable("NO_LAUNCH_ELEVATION", "Altitude du terrain indisponible.");
  if (input.plannedMaximumAltitudeMslM < input.launchElevationMslM) return unavailable("OUTSIDE_DEMO_TABLE", "L’altitude maximale prévue doit être supérieure ou égale à l’altitude du terrain.");
  if (!input.groundTemperature) return unavailable("NO_GROUND_TEMPERATURE", "Température au sol indisponible");
  const permittedTotalMassKg = interpolateDemoPermittedMass(demoCameronZ105.table, input.groundTemperature.temperatureC, input.plannedMaximumAltitudeMslM);
  if (permittedTotalMassKg === null) return unavailable("OUTSIDE_DEMO_TABLE", "Conditions hors de la table de démonstration.");
  const actualTotalMassKg = input.balloonEquipmentWeightKg + input.occupantsWeightKg;
  return { status: "AVAILABLE", calculationMode: "DEMO", permittedTotalMassKg, actualTotalMassKg, marginKg: permittedTotalMassKg - actualTotalMassKg, groundTemperatureC: input.groundTemperature.temperatureC, launchElevationMslM: input.launchElevationMslM, plannedMaximumAltitudeMslM: input.plannedMaximumAltitudeMslM, datasetId: demoCameronZ105.id };
}

export function demoLoadCacheKey(input: LoadCalculationInput): string {
  return JSON.stringify([input.balloonId, input.balloonEquipmentWeightKg, input.occupantsWeightKg, input.launchLatitude, input.launchLongitude, input.launchElevationMslM, input.launchDateTime, input.plannedMaximumAltitudeMslM, input.groundTemperature?.temperatureC, input.groundTemperature?.sourceModel, input.groundTemperature?.forecastRun]);
}
