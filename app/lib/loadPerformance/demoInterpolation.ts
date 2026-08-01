type DemoTable = readonly {
  groundTemperatureC: number;
  valuesByAltitude: readonly { altitudeMslM: number; permittedTotalMassKg: number }[];
}[];

function bounds(values: readonly number[], target: number): [number, number] | null {
  if (values.length === 0 || target < values[0] || target > values.at(-1)!) return null;
  const upper = values.findIndex((value) => value >= target);
  const lower = Math.max(0, upper - 1);
  return [lower, upper];
}

function linear(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return x0 === x1 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/** Interpolation strictement interne à la table UX de démonstration. */
export function interpolateDemoPermittedMass(table: DemoTable, temperatureC: number, altitudeMslM: number): number | null {
  const temperatureBounds = bounds(table.map((row) => row.groundTemperatureC), temperatureC);
  const altitudeValues = table[0]?.valuesByAltitude.map((value) => value.altitudeMslM) ?? [];
  const altitudeBounds = bounds(altitudeValues, altitudeMslM);
  if (!temperatureBounds || !altitudeBounds) return null;
  const [t0, t1] = temperatureBounds;
  const [a0, a1] = altitudeBounds;
  const low = linear(altitudeMslM, altitudeValues[a0], altitudeValues[a1], table[t0].valuesByAltitude[a0].permittedTotalMassKg, table[t0].valuesByAltitude[a1].permittedTotalMassKg);
  const high = linear(altitudeMslM, altitudeValues[a0], altitudeValues[a1], table[t1].valuesByAltitude[a0].permittedTotalMassKg, table[t1].valuesByAltitude[a1].permittedTotalMassKg);
  return linear(temperatureC, table[t0].groundTemperatureC, table[t1].groundTemperatureC, low, high);
}
