import {
  addManualOfficialAscension,
  confirmPilotExperience,
  createEmptyFlightCompletionState,
  ensureCompletionJournalFlight,
  FLIGHT_COMPLETION_SCHEMA_VERSION,
  type FlightCompletionState,
  type OfficialAscensionInput,
  validateOfficialAscension,
} from "./flightCompletion.ts";

const STORAGE_KEY = "balloon-companion-flight-completion-v1";
export const FLIGHT_COMPLETION_EVENT = "balloon-companion-flight-completion-changed";

function normalizeState(value: unknown): FlightCompletionState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<FlightCompletionState>;
  if (!state.openingBalance || !Array.isArray(state.journalFlights) ||
      !Array.isArray(state.officialAscensions)) return null;
  const opening = state.openingBalance as Partial<FlightCompletionState["openingBalance"]>;
  const ascensions = typeof opening.ascensions === "number" ? opening.ascensions : null;
  const officialDurationMinutes = typeof opening.officialDurationMinutes === "number"
    ? opening.officialDurationMinutes : null;
  return {
    version: FLIGHT_COMPLETION_SCHEMA_VERSION,
    openingBalance: {
      confirmed: typeof opening.confirmed === "boolean"
        ? opening.confirmed
        : ascensions !== null && officialDurationMinutes !== null,
      ascensions,
      officialDurationMinutes,
    },
    journalFlights: state.journalFlights,
    officialAscensions: state.officialAscensions,
  };
}

export function loadFlightCompletionState(): FlightCompletionState {
  if (typeof window === "undefined") return createEmptyFlightCompletionState();
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return normalizeState(value) ?? createEmptyFlightCompletionState();
  } catch {
    return createEmptyFlightCompletionState();
  }
}

export function persistPilotExperience(balance: {
  hours: number;
  minutes: number;
  ascensions: number;
}): FlightCompletionState {
  const state = confirmPilotExperience(loadFlightCompletionState(), balance);
  saveFlightCompletionState(state);
  return state;
}

function createManualAscensionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `manual-ascension-${crypto.randomUUID()}`;
  }
  return `manual-ascension-${Date.now()}`;
}

export function persistManualOfficialAscension(
  input: OfficialAscensionInput,
): FlightCompletionState {
  const state = addManualOfficialAscension(
    loadFlightCompletionState(),
    createManualAscensionId(),
    input,
  );
  saveFlightCompletionState(state);
  return state;
}

export function saveFlightCompletionState(state: FlightCompletionState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(FLIGHT_COMPLETION_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function ensureDemoCompletionPersisted(): FlightCompletionState {
  const state = ensureCompletionJournalFlight(loadFlightCompletionState());
  saveFlightCompletionState(state);
  return state;
}

export function persistOfficialAscension(
  sourceFlightId: string,
  input: OfficialAscensionInput,
): FlightCompletionState {
  const state = validateOfficialAscension(
    loadFlightCompletionState(),
    sourceFlightId,
    input,
  );
  saveFlightCompletionState(state);
  return state;
}
