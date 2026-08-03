import type { LoadCalculationInput } from "../types.ts";
import { cameronZ105Parameters } from "../modelParameters/cameronModels.ts";
import type { LoadModelParameterSet } from "../modelParameters/types.ts";

export const CAMERON_MAXIMUM_INTERNAL_TEMPERATURE_C = 100;
const CELSIUS_TO_KELVIN = 273.15;
const SEA_LEVEL_PRESSURE_HPA = 1013.25;
const STANDARD_LAPSE_RATE_C_PER_M = 0.0065;

export type CameronOfficialCalculation = Readonly<{
  ambientTemperatureAtMaximumAltitudeC: number;
  pressureAtMaximumAltitudeHpa: number;
  performanceLimitedMassKg: number;
  permittedTotalMassKg: number;
  actualTotalMassKg: number;
  marginKg: number;
  limitingRule: "CAMERON_LIFT" | "APPLICABLE_MTOW";
}>;

/**
 * Cameron HABFM Issue 10 Amendment 18, Appendix 2 page A2-1.
 * The manual supplies the ground temperature and applies the ISA lapse rate itself.
 */
export function calculateCameronMethodA2Candidate(
  input: LoadCalculationInput,
  modelParameters: LoadModelParameterSet,
): CameronOfficialCalculation | null {
  const groundTemperatureC = input.groundTemperature?.temperatureC;
  const values = [
    input.volumeM3,
    input.balloonEquipmentWeightKg,
    input.occupantsWeightKg,
    input.launchElevationMslM,
    input.plannedMaximumAltitudeMslM,
    groundTemperatureC,
    input.applicableMtowKg,
  ];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const normalizedInputModel = input.model?.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const normalizedParameterModel = modelParameters.model.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (modelParameters.manufacturerMethodId !== "CAMERON_METHOD_A2") return null;
  if (normalizedInputModel !== normalizedParameterModel || input.volumeM3 !== modelParameters.volumeM3) return null;
  if (input.volumeM3! <= 0 || input.balloonEquipmentWeightKg! <= 0 || input.occupantsWeightKg! < 0 || input.applicableMtowKg! <= 0) return null;
  if (input.plannedMaximumAltitudeMslM! < input.launchElevationMslM!) return null;

  const ambientTemperatureAtMaximumAltitudeC = groundTemperatureC!
    - STANDARD_LAPSE_RATE_C_PER_M * (input.plannedMaximumAltitudeMslM! - input.launchElevationMslM!);
  const pressureBase = 1 - (STANDARD_LAPSE_RATE_C_PER_M * input.plannedMaximumAltitudeMslM!) / 288.15;
  if (pressureBase <= 0 || ambientTemperatureAtMaximumAltitudeC <= -CELSIUS_TO_KELVIN) return null;
  const pressureAtMaximumAltitudeHpa = SEA_LEVEL_PRESSURE_HPA * pressureBase ** 5.256;
  const performanceLimitedMassKg = 0.3484 * input.volumeM3! * pressureAtMaximumAltitudeHpa * (
    1 / (ambientTemperatureAtMaximumAltitudeC + CELSIUS_TO_KELVIN)
    - 1 / (CAMERON_MAXIMUM_INTERNAL_TEMPERATURE_C + CELSIUS_TO_KELVIN)
  );
  const limits = [
    { value: performanceLimitedMassKg, rule: "CAMERON_LIFT" as const },
    { value: input.applicableMtowKg!, rule: "APPLICABLE_MTOW" as const },
  ];
  const limiting = limits.reduce((lowest, candidate) => candidate.value < lowest.value ? candidate : lowest);
  const actualTotalMassKg = input.balloonEquipmentWeightKg! + input.occupantsWeightKg!;
  return {
    ambientTemperatureAtMaximumAltitudeC,
    pressureAtMaximumAltitudeHpa,
    performanceLimitedMassKg,
    permittedTotalMassKg: limiting.value,
    actualTotalMassKg,
    marginKg: limiting.value - actualTotalMassKg,
    limitingRule: limiting.rule,
  };
}

/** Compatibility wrapper: the only audited candidate/golden case remains Z-105. */
export function calculateCameronOfficialCandidate(input: LoadCalculationInput): CameronOfficialCalculation | null {
  return calculateCameronMethodA2Candidate(input, cameronZ105Parameters);
}
