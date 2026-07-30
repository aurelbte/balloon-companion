import type {
  Balloon,
  ConditionsData,
  HeroRingData,
  LastFlightData,
  PilotStatusData,
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
  pilotStatus: {
    flightTest: {
      label: "Vol test",
      dueDate: "30/04/2027",
      remainingMonths: 9,
    },
    medical: {
      label: "Médical",
      dueDate: "04/05/2031",
      remainingMonths: 57,
    },
  } satisfies PilotStatusData,
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
  balloons: [
    {
      id: "active-balloon",
      registration: "",
      manufacturer: "Cameron",
      model: "Z-105",
      isFavorite: true,
      documents: [],
      weights: {},
    },
  ] satisfies Balloon[],
} as const;
