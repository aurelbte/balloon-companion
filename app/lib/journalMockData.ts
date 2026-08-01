export type JournalFlightPoint = {
  longitude: number;
  latitude: number;
  elapsedMinutes: number;
  altitudeM: number;
  speedKmh: number;
};

export type JournalFlightStatistics = {
  takeoffAltitudeAmslM: number;
  landingAltitudeAmslM: number;
  averageAltitudeAmslM: number;
  averageSpeedKmh: number;
  minimumInFlightSpeedKmh: number;
  maximumClimbRateMps: number;
  maximumDescentRateMps: number;
  averageHeadingDeg: number;
  directDistanceKm: number;
};

export type JournalFlight = {
  id: string;
  departure: string;
  arrival: string;
  date: string;
  dateIso: string;
  balloonRegistration: string;
  durationMinutes: number;
  distanceKm: number;
  takeoffTime: string;
  landingTime: string;
  maxAltitudeM: number;
  maxSpeedKmh: number;
  notes: string | null;
  statistics: JournalFlightStatistics;
  points: readonly JournalFlightPoint[];
};

function point(
  longitude: number,
  latitude: number,
  elapsedMinutes: number,
  altitudeM: number,
  speedKmh: number,
): JournalFlightPoint {
  return { longitude, latitude, elapsedMinutes, altitudeM, speedKmh };
}

function densifyPoints(
  controlPoints: readonly JournalFlightPoint[],
  durationMinutes: number,
): JournalFlightPoint[] {
  const elapsedValues = [
    ...Array.from(
      { length: Math.floor(durationMinutes / 2) + 1 },
      (_, index) => index * 2,
    ),
    ...(durationMinutes % 2 === 0 ? [] : [durationMinutes]),
  ];
  return elapsedValues.map((elapsedMinutes) => {
    const afterIndex = controlPoints.findIndex(
      (candidate) => candidate.elapsedMinutes >= elapsedMinutes,
    );
    const after = controlPoints[Math.max(0, afterIndex)];
    const before = controlPoints[Math.max(0, afterIndex - 1)] ?? after;
    if (!before || !after || before.elapsedMinutes === after.elapsedMinutes) {
      return { ...(after ?? controlPoints[0]!) };
    }
    const ratio =
      (elapsedMinutes - before.elapsedMinutes) /
      (after.elapsedMinutes - before.elapsedMinutes);
    return point(
      before.longitude + (after.longitude - before.longitude) * ratio,
      before.latitude + (after.latitude - before.latitude) * ratio,
      elapsedMinutes,
      Math.round(before.altitudeM + (after.altitudeM - before.altitudeM) * ratio),
      Number(
        (before.speedKmh + (after.speedKmh - before.speedKmh) * ratio).toFixed(1),
      ),
    );
  });
}

const JOURNAL_FLIGHT_DEFINITIONS: readonly JournalFlight[] = [
  {
    id: "lfqo-merignies",
    departure: "LFQO",
    arrival: "Mérignies",
    date: "29 juillet 2026",
    dateIso: "2026-07-29",
    balloonRegistration: "F-HLFM",
    durationMinutes: 52,
    distanceKm: 17.8,
    takeoffTime: "06:31",
    landingTime: "07:23",
    maxAltitudeM: 982,
    maxSpeedKmh: 28,
    notes: "Vent régulier sur la seconde moitié du vol.",
    statistics: {
      takeoffAltitudeAmslM: 45,
      landingAltitudeAmslM: 51,
      averageAltitudeAmslM: 574,
      averageSpeedKmh: 20.5,
      minimumInFlightSpeedKmh: 7,
      maximumClimbRateMps: 3.1,
      maximumDescentRateMps: -2.4,
      averageHeadingDeg: 128,
      directDistanceKm: 16.9,
    },
    points: [
      point(3.079865, 50.686341, 0, 52, 0),
      point(3.094, 50.68, 4, 210, 13),
      point(3.112, 50.672, 8, 438, 18),
      point(3.131, 50.664, 12, 682, 22),
      point(3.151, 50.655, 16, 861, 25),
      point(3.172, 50.645, 20, 954, 28),
      point(3.194, 50.636, 24, 982, 26),
      point(3.216, 50.626, 28, 966, 24),
      point(3.237, 50.616, 32, 912, 23),
      point(3.257, 50.606, 36, 824, 22),
      point(3.276, 50.596, 40, 684, 21),
      point(3.294, 50.586, 44, 486, 19),
      point(3.309, 50.577, 48, 238, 15),
      point(3.321, 50.57, 52, 61, 7),
    ],
  },
  {
    id: "bondues-templeuve",
    departure: "Bondues",
    arrival: "Templeuve",
    date: "18 juillet 2026",
    dateIso: "2026-07-18",
    balloonRegistration: "F-GTET",
    durationMinutes: 47,
    distanceKm: 15.2,
    takeoffTime: "06:18",
    landingTime: "07:05",
    maxAltitudeM: 811,
    maxSpeedKmh: 24,
    notes: null,
    statistics: {
      takeoffAltitudeAmslM: 45,
      landingAltitudeAmslM: 54,
      averageAltitudeAmslM: 492,
      averageSpeedKmh: 18.2,
      minimumInFlightSpeedKmh: 8,
      maximumClimbRateMps: 2.8,
      maximumDescentRateMps: -2.1,
      averageHeadingDeg: 126,
      directDistanceKm: 14.7,
    },
    points: [
      point(3.058, 50.631, 0, 45, 0),
      point(3.087, 50.617, 8, 344, 17),
      point(3.12, 50.603, 16, 702, 24),
      point(3.154, 50.59, 25, 811, 22),
      point(3.192, 50.578, 34, 756, 20),
      point(3.226, 50.565, 41, 391, 18),
      point(3.252, 50.555, 47, 54, 8),
    ],
  },
  {
    id: "hesdin-aire-sur-la-lys",
    departure: "Hesdin",
    arrival: "Aire-sur-la-Lys",
    date: "6 juillet 2026",
    dateIso: "2026-07-06",
    balloonRegistration: "F-HOBA",
    durationMinutes: 64,
    distanceKm: 24.6,
    takeoffTime: "06:42",
    landingTime: "07:46",
    maxAltitudeM: 1244,
    maxSpeedKmh: 31,
    notes: null,
    statistics: {
      takeoffAltitudeAmslM: 34,
      landingAltitudeAmslM: 28,
      averageAltitudeAmslM: 762,
      averageSpeedKmh: 23.1,
      minimumInFlightSpeedKmh: 7,
      maximumClimbRateMps: 3.4,
      maximumDescentRateMps: -2.7,
      averageHeadingDeg: 43,
      directDistanceKm: 23.8,
    },
    points: [
      point(2.036, 50.373, 0, 34, 0),
      point(2.078, 50.401, 10, 422, 20),
      point(2.12, 50.429, 20, 903, 29),
      point(2.16, 50.458, 30, 1244, 31),
      point(2.205, 50.486, 40, 1190, 28),
      point(2.25, 50.515, 50, 782, 24),
      point(2.294, 50.542, 58, 351, 18),
      point(2.333, 50.565, 64, 28, 7),
    ],
  },
  {
    id: "chambley-metz",
    departure: "Chambley",
    arrival: "Metz",
    date: "21 juin 2026",
    dateIso: "2026-06-21",
    balloonRegistration: "F-HMIG",
    durationMinutes: 58,
    distanceKm: 21.3,
    takeoffTime: "05:56",
    landingTime: "06:54",
    maxAltitudeM: 1068,
    maxSpeedKmh: 27,
    notes: null,
    statistics: {
      takeoffAltitudeAmslM: 265,
      landingAltitudeAmslM: 171,
      averageAltitudeAmslM: 714,
      averageSpeedKmh: 21.4,
      minimumInFlightSpeedKmh: 8,
      maximumClimbRateMps: 2.9,
      maximumDescentRateMps: -2.2,
      averageHeadingDeg: 49,
      directDistanceKm: 20.5,
    },
    points: [
      point(5.887, 49.024, 0, 265, 0),
      point(5.92, 49.044, 9, 548, 16),
      point(5.956, 49.066, 18, 895, 23),
      point(5.994, 49.088, 27, 1068, 27),
      point(6.032, 49.11, 36, 1032, 25),
      point(6.07, 49.133, 45, 744, 22),
      point(6.108, 49.154, 52, 421, 17),
      point(6.142, 49.171, 58, 171, 8),
    ],
  },
] as const;

export const JOURNAL_FLIGHTS: readonly JournalFlight[] =
  JOURNAL_FLIGHT_DEFINITIONS.map((flight) => ({
    ...flight,
    points: densifyPoints(flight.points, flight.durationMinutes),
  }));

export function getJournalFlight(id: string): JournalFlight | null {
  return JOURNAL_FLIGHTS.find((flight) => flight.id === id) ?? null;
}

export function getJournalFlightAutomaticName(flight: JournalFlight): string {
  return `${flight.departure} → ${flight.arrival}`;
}
