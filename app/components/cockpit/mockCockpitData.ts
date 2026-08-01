import type {
  ConditionsData,
  HeroRingData,
  LastFlightData,
} from "./types";

/**
 * Temporary presentation data. Keeping it outside the components makes the
 * future replacement by domain data explicit without coupling the UI to it.
 */
export const MOCK_COCKPIT_DATA = {
  hero: {
    totalHours: 136 + 35 / 60,
    displayHours: "136 h",
    flights: 108,
  } satisfies HeroRingData,
  conditions: {
    windDirectionDeg: 130,
    wind: "12 km/h",
    gusts: "18 km/h",
    temperature: "16°C",
    sunrise: "05:58",
    sunset: "21:42",
  } satisfies ConditionsData,
  lastFlight: {
    date: "29 juillet 2026",
    duration: "52 min",
    departure: "Bondues",
    arrival: "Templeuve",
  } satisfies LastFlightData,
} as const;
