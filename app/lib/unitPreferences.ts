export type WeatherWindSpeedUnit = "km/h" | "kt";
export type TemperatureUnit = "°C" | "°F";
export type FlightSpeedUnit = "km/h" | "kt";
export type AltitudeUnit = "m" | "ft";
export type DistanceUnit = "km" | "NM";

export type UnitPreferences = {
  weather: { windSpeedUnit: WeatherWindSpeedUnit; temperatureUnit: TemperatureUnit };
  flightInstruments: { speedUnit: FlightSpeedUnit; altitudeUnit: AltitudeUnit; distanceUnit: DistanceUnit };
};

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  weather: { windSpeedUnit: "km/h", temperatureUnit: "°C" },
  flightInstruments: { speedUnit: "km/h", altitudeUnit: "m", distanceUnit: "km" },
};

const KMH_PER_KNOT = 1.852;
const FEET_PER_METRE = 3.280839895;
const KM_PER_NAUTICAL_MILE = 1.852;

export const kmhToKnots = (value: number): number => value / KMH_PER_KNOT;
export const knotsToKmh = (value: number): number => value * KMH_PER_KNOT;
export const metresToFeet = (value: number): number => value * FEET_PER_METRE;
export const feetToMetres = (value: number): number => value / FEET_PER_METRE;
export const kilometresToNauticalMiles = (value: number): number => value / KM_PER_NAUTICAL_MILE;
export const nauticalMilesToKilometres = (value: number): number => value * KM_PER_NAUTICAL_MILE;
export const celsiusToFahrenheit = (value: number): number => value * 9 / 5 + 32;
export const fahrenheitToCelsius = (value: number): number => (value - 32) * 5 / 9;

export type FlightAltitudeReading = { value: string; unit: AltitudeUnit };

export function getFlightAltitudeReadings(valueMetres: number | null, primaryUnit: AltitudeUnit): { primary: FlightAltitudeReading; secondary: FlightAltitudeReading } | null {
  if (valueMetres === null || !Number.isFinite(valueMetres)) return null;
  const metres = { value: Math.round(valueMetres).toLocaleString("fr-FR"), unit: "m" as const };
  const feet = { value: Math.round(metresToFeet(valueMetres)).toLocaleString("fr-FR"), unit: "ft" as const };
  return primaryUnit === "m" ? { primary: metres, secondary: feet } : { primary: feet, secondary: metres };
}

function format(value: number, unit: string, precision: number): string {
  return `${value.toFixed(precision)} ${unit}`;
}

export function formatWeatherWind(valueKmh: number, unit: WeatherWindSpeedUnit, precision = 0): string {
  return format(unit === "kt" ? kmhToKnots(valueKmh) : valueKmh, unit, precision);
}

export function formatWeatherTemperature(valueCelsius: number, unit: TemperatureUnit, precision = 0): string {
  return format(unit === "°F" ? celsiusToFahrenheit(valueCelsius) : valueCelsius, unit, precision);
}

export function formatFlightSpeed(valueKmh: number, unit: FlightSpeedUnit, precision = 0): string {
  return format(unit === "kt" ? kmhToKnots(valueKmh) : valueKmh, unit, precision);
}

export function formatFlightAltitude(valueMetres: number, unit: AltitudeUnit, precision = 0): string {
  return format(unit === "ft" ? metresToFeet(valueMetres) : valueMetres, unit, precision);
}

export function formatFlightDistance(valueKilometres: number, unit: DistanceUnit, precision = 1): string {
  return format(unit === "NM" ? kilometresToNauticalMiles(valueKilometres) : valueKilometres, unit, precision);
}

// Les données aéronautiques officielles (openAIP, METAR et TAF) conservent toujours
// leur valeur et leur unité d'origine, indépendamment des préférences pilote.
export function preserveOfficialAviationUnit(value: string): string { return value; }
