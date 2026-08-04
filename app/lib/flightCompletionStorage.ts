import {
  addManualOfficialAscension,
  confirmPilotExperience,
  createEmptyFlightCompletionState,
  ensureCompletionJournalFlight,
  FLIGHT_COMPLETION_SCHEMA_VERSION,
  type FlightCompletionState,
  type OfficialAscensionInput,
  validateOfficialAscension,
  type CompletionJournalFlight,
  removeJournalFlight,
  setJournalFlightLogbookStatus,
} from "./flightCompletion.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";
import { legacyFlightSessionToRecordedFlight } from "./realFlightJournal.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { loadFlightSession } from "./flightSessionStorage.ts";

export const FLIGHT_COMPLETION_STORAGE_KEY = "balloon-companion-flight-completion-v1";
const STORAGE_KEY = FLIGHT_COMPLETION_STORAGE_KEY;
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
    journalFlights: state.journalFlights.map((flight) => {
      const legacyStatus = (flight as { logbookStatus?: string }).logbookStatus;
      return {
        ...flight,
        logbookStatus: legacyStatus === "VALIDATED" ? "CARNET_VALIDATED"
          : legacyStatus === "JOURNAL_ONLY" ? "JOURNAL_ONLY"
          : legacyStatus === "CARNET_VALIDATED" ? "CARNET_VALIDATED"
          : "CARNET_PENDING",
      };
    }),
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

export function persistJournalFlight(flight: CompletionJournalFlight): FlightCompletionState {
  const state = ensureCompletionJournalFlight(loadFlightCompletionState(), flight);
  saveFlightCompletionState(state);
  return state;
}

export function persistRecordedFlightInJournal(
  flight: RecordedFlight,
  options: Readonly<{ recovered?: boolean; balloonRegistration?: string }> = {},
): FlightCompletionState {
  return persistJournalFlight(recordedFlightToJournalFlight(flight, options));
}

/** Migration additive : la source IndexedDB historique est conservée intacte. */
export async function migrateCompletedRecordedFlightsToJournal(): Promise<number> {
  const storage = new IndexedDbRecordedFlightStorage();
  const flights = await storage.listFlights();
  const legacy = loadFlightSession();
  if (legacy) {
    const converted = legacyFlightSessionToRecordedFlight(legacy);
    if (converted?.status === "COMPLETED" && !flights.some(({ id }) => id === converted.id)) flights.push(converted);
  }
  let migrated = 0;
  for (const flight of flights) {
    const state = loadFlightCompletionState();
    if (state.journalFlights.some(({ id }) => id === flight.id)) continue;
    persistRecordedFlightInJournal(flight);
    migrated += 1;
  }
  return migrated;
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

export function persistJournalFlightDecision(
  flightId: string,
  decision: "CARNET_PENDING" | "JOURNAL_ONLY",
): FlightCompletionState {
  const state = setJournalFlightLogbookStatus(loadFlightCompletionState(), flightId, decision);
  saveFlightCompletionState(state);
  return state;
}

export function persistJournalFlightDeletion(flightId: string, removeLinkedAscension: boolean): FlightCompletionState {
  const state = removeJournalFlight(loadFlightCompletionState(), flightId, removeLinkedAscension);
  saveFlightCompletionState(state);
  return state;
}

export async function deleteRecordedJournalFlight(flightId: string, removeLinkedAscension: boolean): Promise<FlightCompletionState> {
  const storage = new IndexedDbRecordedFlightStorage();
  await storage.deleteFlight(flightId);
  return persistJournalFlightDeletion(flightId, removeLinkedAscension);
}
