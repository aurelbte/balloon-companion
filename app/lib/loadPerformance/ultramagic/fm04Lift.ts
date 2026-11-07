/** Graphique FM04 Rev.30 : p.5.3 Rev.23 / p.5.4 Rev.24, exemples p.5.5 Rev.25. */
export const FM04_INTERNAL_ENVELOPE_TEMPERATURE_C = 100;
/** Printed axes/altitude curves, p.5.3 Rev.23. A conservative domain, not a method approval. */
export const FM04_GRAPH_DOMAIN = Object.freeze({
  minimumAltitudeMslM: 0, maximumAltitudeMslM: 7000,
  minimumTemperatureC: -50, maximumTemperatureC: 40,
  minimumLiftKgPer1000Ft3: 4.5, maximumLiftKgPer1000Ft3: 10,
});

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
 * Reconstruction analytique candidate inspirée du graphique FM04, non validée.
 * La parallèle à l'ISA est documentée ; les coefficients de cette formule ne
 * sont pas publiés dans les pages disponibles. Les gardes bornent le calcul aux
 * axes/courbes imprimés et excluent les points hors de la fenêtre de lecture.
 * Aucun résultat brut de cette fonction n'est une charge admissible.
 */
export function calculateFm04LiftKgPer1000Ft3(input: Fm04LiftInput): number | null {
  const { groundTemperatureC, launchElevationMslM, maximumAltitudeMslM } = input;
  if (![groundTemperatureC, launchElevationMslM, maximumAltitudeMslM].every(Number.isFinite)) return null;
  if (maximumAltitudeMslM < launchElevationMslM) return null;

  const domain = FM04_GRAPH_DOMAIN;
  if (launchElevationMslM < domain.minimumAltitudeMslM || maximumAltitudeMslM > domain.maximumAltitudeMslM
    || groundTemperatureC < domain.minimumTemperatureC || groundTemperatureC > domain.maximumTemperatureC) return null;
  const maximumTemperatureC = groundTemperatureC - ISA_LAPSE_RATE_K_PER_M * (maximumAltitudeMslM - launchElevationMslM);
  if (maximumTemperatureC < domain.minimumTemperatureC || maximumTemperatureC > domain.maximumTemperatureC) return null;
  const atLaunch = calculateAnalyticalLift(groundTemperatureC + CELSIUS_TO_KELVIN, launchElevationMslM);
  const atMaximum = calculateAnalyticalLift(
    groundTemperatureC + CELSIUS_TO_KELVIN - ISA_LAPSE_RATE_K_PER_M * (maximumAltitudeMslM - launchElevationMslM),
    maximumAltitudeMslM,
  );
  // Both ends of the graphical construction must be readable; never extend a
  // clipped curve or clamp a computed value back into the printed chart.
  if ([atLaunch, atMaximum].some((value) => value === null
    || value < domain.minimumLiftKgPer1000Ft3 || value > domain.maximumLiftKgPer1000Ft3)) return null;
  return atMaximum;
}

function calculateAnalyticalLift(ambientTemperatureAtMaximumK: number, altitudeMslM: number): number | null {
  const internalTemperatureK = FM04_INTERNAL_ENVELOPE_TEMPERATURE_C + CELSIUS_TO_KELVIN;
  const pressureBase = 1 - (ISA_LAPSE_RATE_K_PER_M * altitudeMslM) / STANDARD_SEA_LEVEL_TEMPERATURE_K;
  if (ambientTemperatureAtMaximumK <= 0 || pressureBase <= 0) return null;

  const pressureAtMaximumPa = STANDARD_SEA_LEVEL_PRESSURE_PA * pressureBase ** ISA_PRESSURE_EXPONENT;
  const liftKgPerM3 = pressureAtMaximumPa / DRY_AIR_SPECIFIC_GAS_CONSTANT_J_PER_KG_K
    * (1 / ambientTemperatureAtMaximumK - 1 / internalTemperatureK);
  const liftKgPer1000Ft3 = liftKgPerM3 * FM04_CUBIC_METRES_PER_1000_CUBIC_FEET;
  return Number.isFinite(liftKgPer1000Ft3) && liftKgPer1000Ft3 >= 0 ? liftKgPer1000Ft3 : null;
}
