/** Ultramagic FM04 Revision 30, section 5.3, pages 5.3 à 5.5. */
export const FM04_INTERNAL_ENVELOPE_TEMPERATURE_C = 100;

// Constantes de l'atmosphère standard internationale et de l'équation des gaz parfaits.
const CELSIUS_TO_KELVIN = 273.15;
const STANDARD_SEA_LEVEL_TEMPERATURE_K = 288.15;
const STANDARD_SEA_LEVEL_PRESSURE_PA = 101_325;
const STANDARD_GRAVITY_MPS2 = 9.80665;
const DRY_AIR_SPECIFIC_GAS_CONSTANT_J_PER_KG_K = 287.05;
const ISA_LAPSE_RATE_K_PER_M = 0.0065;
export const FM04_CUBIC_METRES_PER_1000_CUBIC_FEET = 28.316846592;
const ISA_PRESSURE_EXPONENT = STANDARD_GRAVITY_MPS2
  / (DRY_AIR_SPECIFIC_GAS_CONSTANT_J_PER_KG_K * ISA_LAPSE_RATE_K_PER_M);

export type Fm04LiftInput = Readonly<{
  groundTemperatureC: number;
  launchElevationMslM: number;
  maximumAltitudeMslM: number;
}>;

/**
 * Reproduit la construction FM04 : la température suit une parallèle à l'ISA
 * depuis le terrain, puis la poussée d'Archimède est calculée à l'altitude maximale.
 */
export function calculateFm04LiftKgPer1000Ft3(input: Fm04LiftInput): number | null {
  const { groundTemperatureC, launchElevationMslM, maximumAltitudeMslM } = input;
  if (![groundTemperatureC, launchElevationMslM, maximumAltitudeMslM].every(Number.isFinite)) return null;
  if (maximumAltitudeMslM < launchElevationMslM) return null;

  const ambientTemperatureAtMaximumK = groundTemperatureC + CELSIUS_TO_KELVIN
    - ISA_LAPSE_RATE_K_PER_M * (maximumAltitudeMslM - launchElevationMslM);
  const internalTemperatureK = FM04_INTERNAL_ENVELOPE_TEMPERATURE_C + CELSIUS_TO_KELVIN;
  const pressureBase = 1
    - (ISA_LAPSE_RATE_K_PER_M * maximumAltitudeMslM) / STANDARD_SEA_LEVEL_TEMPERATURE_K;
  if (ambientTemperatureAtMaximumK <= 0 || pressureBase <= 0) return null;

  const pressureAtMaximumPa = STANDARD_SEA_LEVEL_PRESSURE_PA
    * pressureBase ** ISA_PRESSURE_EXPONENT;
  const liftKgPerM3 = pressureAtMaximumPa / DRY_AIR_SPECIFIC_GAS_CONSTANT_J_PER_KG_K
    * (1 / ambientTemperatureAtMaximumK - 1 / internalTemperatureK);
  const liftKgPer1000Ft3 = liftKgPerM3 * FM04_CUBIC_METRES_PER_1000_CUBIC_FEET;
  return Number.isFinite(liftKgPer1000Ft3) && liftKgPer1000Ft3 >= 0
    ? liftKgPer1000Ft3
    : null;
}
