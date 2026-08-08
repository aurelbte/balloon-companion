import {
  JOURNAL_FLIGHTS,
  type JournalFlight,
  type JournalFlightPoint,
} from "./journalMockData.ts";

export const FLIGHT_COMPLETION_SCHEMA_VERSION = 4;
export const DEMO_COMPLETION_FLIGHT_ID = "demo-flight-lfqo-merignies-2026-08-01";
export const DEMO_COMPLETION_ASCENSION_ID = "demo-ascension-lfqo-merignies-2026-08-01";

export type PilotExperienceBalance = {
  confirmed: boolean;
  ascensions: number | null;
  officialDurationMinutes: number | null;
};

export type CompletionJournalFlight = JournalFlight & {
  logbookStatus: "CARNET_PENDING" | "CARNET_VALIDATED" | "JOURNAL_ONLY";
  origin: "REAL_GPS" | "MANUAL" | "DEMO";
  recovered?: boolean;
};

export type OfficialAscension = {
  id: string;
  sourceFlightId: string | null;
  source: "GPS_BALLOON_COMPANION" | "MANUAL";
  dateIso: string;
  date: string;
  balloonModel: string;
  balloonManufacturer?: string;
  registration: string;
  departure: string;
  arrival: string;
  category: "Libre à air chaud" | "Libre à gaz";
  pilotFunction: "Pilote" | "Élève";
  nightFlight: boolean;
  maximumAltitudeM: number | null;
  gpsDurationMinutes: number | null;
  officialDurationMinutes: number;
  observations: string;
};

export type OfficialAscensionInput = Omit<
  OfficialAscension,
  "id" | "source" | "sourceFlightId" | "gpsDurationMinutes"
>;

export type FlightCompletionState = {
  version: typeof FLIGHT_COMPLETION_SCHEMA_VERSION;
  openingBalance: PilotExperienceBalance;
  journalFlights: CompletionJournalFlight[];
  officialAscensions: OfficialAscension[];
};

export type PilotOfficialTotals = {
  ascensions: number | null;
  officialDurationMinutes: number | null;
  totalHoursExact: number | null;
  displayHours: number | null;
  remainingMinutes: number | null;
};

export const DEMO_OPENING_BALANCE: PilotExperienceBalance = {
  confirmed: true,
  ascensions: 108,
  officialDurationMinutes: 136 * 60 + 35,
};

function demoTrace(): JournalFlightPoint[] {
  const source = JOURNAL_FLIGHTS[0]?.points ?? [];
  const sourceDuration = JOURNAL_FLIGHTS[0]?.durationMinutes ?? 52;
  return source.map((point) => ({
    ...point,
    elapsedMinutes: Number(((point.elapsedMinutes / sourceDuration) * 57).toFixed(2)),
  }));
}

export function createDemoCompletionJournalFlight(): CompletionJournalFlight {
  return {
    id: DEMO_COMPLETION_FLIGHT_ID,
    departure: "LFQO",
    arrival: "Mérignies",
    date: "1 août 2026",
    dateIso: "2026-08-01",
    balloonRegistration: "F-HLFM",
    durationMinutes: 57,
    distanceKm: 17.8,
    takeoffTime: "06:31",
    landingTime: "07:28",
    maxAltitudeM: 982,
    maxSpeedKmh: 28,
    notes: null,
    statistics: {
      takeoffAltitudeAmslM: 52,
      landingAltitudeAmslM: 61,
      averageAltitudeAmslM: 574,
      averageSpeedKmh: 18.7,
      minimumInFlightSpeedKmh: 7,
      maximumClimbRateMps: 3.1,
      maximumDescentRateMps: -2.4,
      averageHeadingDeg: 128,
      directDistanceKm: 16.9,
    },
    points: demoTrace(),
    logbookStatus: "CARNET_PENDING",
    origin: "DEMO",
  };
}

export function createEmptyFlightCompletionState(): FlightCompletionState {
  return {
    version: FLIGHT_COMPLETION_SCHEMA_VERSION,
    openingBalance: { ...DEMO_OPENING_BALANCE },
    journalFlights: [],
    officialAscensions: [],
  };
}

export function ensureCompletionJournalFlight(
  state: FlightCompletionState,
  flight: CompletionJournalFlight = createDemoCompletionJournalFlight(),
): FlightCompletionState {
  const existingIndex = state.journalFlights.findIndex(({ id }) => id === flight.id);
  if (existingIndex < 0) {
    return { ...state, journalFlights: [...state.journalFlights, flight] };
  }
  const existing = state.journalFlights[existingIndex]!;
  const nextFlight = {
    ...flight,
    logbookStatus: existing.logbookStatus,
    ...(existing.customTitle ? { customTitle: existing.customTitle } : {}),
  };
  const journalFlights = [...state.journalFlights];
  journalFlights[existingIndex] = nextFlight;
  return { ...state, journalFlights };
}

export function validateOfficialAscension(
  currentState: FlightCompletionState,
  sourceFlightId: string,
  input: OfficialAscensionInput,
): FlightCompletionState {
  const state = ensureCompletionJournalFlight(currentState);
  const sourceFlight = state.journalFlights.find(({ id }) => id === sourceFlightId);
  if (!sourceFlight) return state;
  const ascension: OfficialAscension = {
    ...input,
    id: sourceFlightId === DEMO_COMPLETION_FLIGHT_ID ? DEMO_COMPLETION_ASCENSION_ID : `ascension-${sourceFlightId}`,
    sourceFlightId,
    source: "GPS_BALLOON_COMPANION",
    gpsDurationMinutes: sourceFlight.durationMinutes,
  };
  const existingIndex = state.officialAscensions.findIndex(
    (item) => item.sourceFlightId === sourceFlightId,
  );
  const officialAscensions = [...state.officialAscensions];
  if (existingIndex >= 0) officialAscensions[existingIndex] = ascension;
  else officialAscensions.push(ascension);
  return {
    ...state,
    journalFlights: state.journalFlights.map((flight) =>
      flight.id === sourceFlightId ? { ...flight, logbookStatus: "CARNET_VALIDATED" } : flight,
    ),
    officialAscensions,
  };
}

export function calculatePilotOfficialTotals(
  state: Pick<FlightCompletionState, "openingBalance" | "officialAscensions">,
): PilotOfficialTotals {
  if (
    !state.openingBalance.confirmed ||
    state.openingBalance.ascensions === null ||
    state.openingBalance.officialDurationMinutes === null
  ) {
    return {
      ascensions: null,
      officialDurationMinutes: null,
      totalHoursExact: null,
      displayHours: null,
      remainingMinutes: null,
    };
  }
  const officialDurationMinutes = state.officialAscensions.reduce(
    (total, ascension) => total + ascension.officialDurationMinutes,
    state.openingBalance.officialDurationMinutes,
  );
  return {
    ascensions: state.openingBalance.ascensions + state.officialAscensions.length,
    officialDurationMinutes,
    totalHoursExact: officialDurationMinutes / 60,
    displayHours: Math.floor(officialDurationMinutes / 60),
    remainingMinutes: officialDurationMinutes % 60,
  };
}

export function confirmPilotExperience(
  state: FlightCompletionState,
  balance: { hours: number; minutes: number; ascensions: number },
): FlightCompletionState {
  if (
    !Number.isInteger(balance.hours) || balance.hours < 0 ||
    !Number.isInteger(balance.minutes) || balance.minutes < 0 || balance.minutes > 59 ||
    !Number.isInteger(balance.ascensions) || balance.ascensions < 0
  ) {
    return state;
  }
  return {
    ...state,
    openingBalance: {
      confirmed: true,
      ascensions: balance.ascensions,
      officialDurationMinutes: balance.hours * 60 + balance.minutes,
    },
  };
}

export function createUnconfiguredFlightCompletionState(): FlightCompletionState {
  return {
    ...createEmptyFlightCompletionState(),
    openingBalance: {
      confirmed: false,
      ascensions: null,
      officialDurationMinutes: null,
    },
  };
}

export function addManualOfficialAscension(
  state: FlightCompletionState,
  id: string,
  input: OfficialAscensionInput,
): FlightCompletionState {
  if (!id.trim() || state.officialAscensions.some((item) => item.id === id)) return state;
  return {
    ...state,
    officialAscensions: [...state.officialAscensions, {
      ...input,
      id,
      sourceFlightId: null,
      source: "MANUAL",
      gpsDurationMinutes: null,
    }],
  };
}

export function removeOfficialAscension(
  state: FlightCompletionState,
  ascensionId: string,
): FlightCompletionState {
  const removed = state.officialAscensions.find(({ id }) => id === ascensionId);
  if (!removed) return state;
  return {
    ...state,
    officialAscensions: state.officialAscensions.filter(({ id }) => id !== ascensionId),
    journalFlights: state.journalFlights.map((flight) =>
      removed.sourceFlightId !== null && flight.id === removed.sourceFlightId
        ? { ...flight, logbookStatus: "CARNET_PENDING" }
        : flight,
    ),
  };
}

export function updateOfficialAscension(
  state: FlightCompletionState,
  ascensionId: string,
  input: OfficialAscensionInput,
): FlightCompletionState {
  const index = state.officialAscensions.findIndex(({ id }) => id === ascensionId);
  if (index < 0) return state;
  const current = state.officialAscensions[index]!;
  const unchanged = (Object.keys(input) as Array<keyof OfficialAscensionInput>)
    .every((key) => current[key] === input[key]);
  if (unchanged) return state;
  const officialAscensions = [...state.officialAscensions];
  officialAscensions[index] = {
    ...input,
    id: current.id,
    source: current.source,
    sourceFlightId: current.sourceFlightId,
    gpsDurationMinutes: current.gpsDurationMinutes,
  };
  return { ...state, officialAscensions };
}

export function adjustOfficialDurationMinutes(currentMinutes: number, deltaMinutes: number): number {
  const safeCurrent = Number.isFinite(currentMinutes) ? Math.round(currentMinutes) : 1;
  const safeDelta = Number.isFinite(deltaMinutes) ? Math.round(deltaMinutes) : 0;
  return Math.max(1, safeCurrent + safeDelta);
}

export function setJournalFlightLogbookStatus(
  state: FlightCompletionState,
  flightId: string,
  status: "CARNET_PENDING" | "JOURNAL_ONLY",
): FlightCompletionState {
  const linkedAscension = state.officialAscensions.find(({ sourceFlightId }) => sourceFlightId === flightId);
  if (linkedAscension) return state;
  return {
    ...state,
    journalFlights: state.journalFlights.map((flight) => flight.id === flightId ? { ...flight, logbookStatus: status } : flight),
  };
}

export function setJournalFlightCustomTitle(
  state: FlightCompletionState,
  flightId: string,
  customTitle: string | null,
): FlightCompletionState {
  return {
    ...state,
    journalFlights: state.journalFlights.map((flight) => {
      if (flight.id !== flightId) return flight;
      const next = { ...flight };
      if (customTitle?.trim()) next.customTitle = customTitle.trim();
      else delete next.customTitle;
      return next;
    }),
  };
}

export function removeJournalFlight(
  state: FlightCompletionState,
  flightId: string,
  removeLinkedAscension: boolean,
): FlightCompletionState {
  return {
    ...state,
    journalFlights: state.journalFlights.filter(({ id }) => id !== flightId),
    officialAscensions: removeLinkedAscension
      ? state.officialAscensions.filter(({ sourceFlightId }) => sourceFlightId !== flightId)
      : state.officialAscensions,
  };
}

export function defaultOfficialAscensionInput(): OfficialAscensionInput {
  return {
    dateIso: "2026-08-01",
    date: "1 août 2026",
    balloonModel: "Z105",
    balloonManufacturer: "Cameron",
    registration: "F-HLFM",
    departure: "LFQO",
    arrival: "Mérignies",
    category: "Libre à air chaud",
    pilotFunction: "Pilote",
    nightFlight: false,
    maximumAltitudeM: 982,
    officialDurationMinutes: 57,
    observations: "",
  };
}
