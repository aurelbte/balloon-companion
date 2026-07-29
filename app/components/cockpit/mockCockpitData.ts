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
    totalHours: "128",
    flights: 42,
    terrains: 12,
    countries: 3,
  } satisfies HeroRingData,
  pilotStatus: {
    licence: "Valide",
    medical: "14 mois",
    nextCheck: "12/09/2027",
  } satisfies PilotStatusData,
  conditions: {
    meanWind: "12 km/h",
    gusts: "18 km/h",
    sunrise: "06:08",
    modelName: "AROME",
    modelTime: "05:00",
  } satisfies ConditionsData,
  lastFlight: {
    date: "24 juillet",
    duration: "1 h 08",
    distance: "16,4 km",
    departure: "Bondues",
    arrival: "Baisieux",
    route: [
      { latitude: 50.7012, longitude: 3.0871 },
      { latitude: 50.6896, longitude: 3.1048 },
      { latitude: 50.6769, longitude: 3.1315 },
      { latitude: 50.6614, longitude: 3.1578 },
      { latitude: 50.6486, longitude: 3.1829 },
    ],
  } satisfies LastFlightData,
  balloons: [
    {
      id: "balloon-f-hlfm",
      registration: "F-HLFM",
      manufacturer: "Cameron",
      model: "Z-105",
      volumeM3: 2_975,
      isFavorite: true,
      lastUsedAt: "2026-07-24T06:10:00+02:00",
      documents: [
        {
          id: "insurance-f-hlfm",
          type: "insurance",
          label: "Assurance",
          expirationDate: "2027-03-31",
          status: "valid",
        },
        {
          id: "cdn-f-hlfm",
          type: "cdn",
          label: "Certificat de navigabilité",
          expirationDate: "2027-06-30",
          status: "valid",
        },
      ],
      weights: {
        envelopeKg: 112,
        basketKg: 95,
        burnerKg: 24,
        cylinderKg: 18,
        cylinderCount: 4,
        equipmentKg: 16,
        emptyOperatingWeightKg: 319,
      },
    },
    {
      id: "balloon-f-xxxx",
      registration: "F-XXXX",
      manufacturer: "Ultramagic",
      model: "M-120",
      volumeM3: 3_400,
      documents: [
        {
          id: "insurance-f-xxxx",
          type: "insurance",
          label: "Assurance",
          expirationDate: "2026-12-31",
          status: "expiring",
        },
      ],
      weights: {
        cylinderCount: 4,
      },
    },
  ] satisfies Balloon[],
} as const;
