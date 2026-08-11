import {
  addManualOfficialAscension,
  confirmPilotExperience,
  createEmptyFlightCompletionState,
  ensureCompletionJournalFlight,
  FLIGHT_COMPLETION_SCHEMA_VERSION,
  type FlightCompletionState,
  type OfficialAscension,
  type OfficialAscensionInput,
  validateOfficialAscension,
  type CompletionJournalFlight,
  removeJournalFlight,
  setJournalFlightLogbookStatus,
  setJournalFlightCustomTitle,
  updateOfficialAscension,
} from "./flightCompletion.ts";
import { buildGeneratedFlightTitle } from "./journalFlightTitle.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";
import { legacyFlightSessionToRecordedFlight } from "./realFlightJournal.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { loadFlightSession } from "./flightSessionStorage.ts";
import { getRuntimeDataScope, readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";

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
      const legacyTitle = typeof flight.title === "string" ? flight.title.trim() : "";
      const generatedTitle = buildGeneratedFlightTitle(flight);
      const customTitle = typeof flight.customTitle === "string" && flight.customTitle.trim()
        ? flight.customTitle.trim()
        : legacyTitle && !/^Vol du\s+\d/i.test(legacyTitle) && legacyTitle !== `${flight.departure} → ${flight.arrival}`
          ? legacyTitle
          : undefined;
      return {
        ...flight,
        generatedTitle,
        ...(customTitle ? { customTitle } : {}),
        title: undefined,
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
  const scope = getRuntimeDataScope();
  const blank: FlightCompletionState = { version: FLIGHT_COMPLETION_SCHEMA_VERSION, openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null }, journalFlights: [], officialAscensions: [] };
  if (!scope) return blank;
  try {
    const raw = readScopedBusinessValue(window.localStorage, STORAGE_KEY);
    if (!raw && scope !== "GUEST") return blank;
    const value: unknown = JSON.parse(raw ?? "null");
    return normalizeState(value) ?? (scope === "GUEST" ? createEmptyFlightCompletionState() : blank);
  } catch {
    return scope === "GUEST" ? createEmptyFlightCompletionState() : blank;
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
    const lightweightState: FlightCompletionState = {
      ...state,
      journalFlights: state.journalFlights.map((flight) => ({
        ...flight,
        sourceFlightId: flight.sourceFlightId ?? flight.id,
        points: [],
      })),
    };
    if (!writeScopedBusinessValue(window.localStorage, STORAGE_KEY, JSON.stringify(lightweightState))) return false;
    window.dispatchEvent(new Event(FLIGHT_COMPLETION_EVENT));
    return true;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[flightCompletionStorage] Écriture Journal impossible", error);
    }
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
): { state: FlightCompletionState; persisted: boolean } {
  const journalFlight = recordedFlightToJournalFlight(flight, options);
  const state = ensureCompletionJournalFlight(loadFlightCompletionState(), journalFlight);
  return { state, persisted: saveFlightCompletionState(state) };
}

export async function loadRecordedFlightForJournal(
  sourceFlightId: string,
): Promise<RecordedFlight | null> {
  return new IndexedDbRecordedFlightStorage().getFlight(sourceFlightId);
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

export function persistOfficialAscensionUpdate(
  ascensionId: string,
  input: OfficialAscensionInput,
): OfficialAscension | null {
  const state = updateOfficialAscension(
    loadFlightCompletionState(),
    ascensionId,
    input,
  );
  const updated = state.officialAscensions.find(({ id }) => id === ascensionId) ?? null;
  if (!updated) {
    if (process.env.NODE_ENV === "development") console.debug("[flightCompletionStorage] updateOfficialAscension", { ascensionId, result: "NOT_FOUND" });
    return null;
  }
  saveFlightCompletionState(state);
  if (process.env.NODE_ENV === "development") console.debug("[flightCompletionStorage] updateOfficialAscension", { ascensionId, result: updated });
  return updated;
}

export function persistJournalFlightDecision(
  flightId: string,
  decision: "CARNET_PENDING" | "JOURNAL_ONLY",
): FlightCompletionState {
  const state = setJournalFlightLogbookStatus(loadFlightCompletionState(), flightId, decision);
  saveFlightCompletionState(state);
  return state;
}

export function persistJournalFlightCustomTitle(
  flightId: string,
  customTitle: string | null,
): FlightCompletionState {
  const state = setJournalFlightCustomTitle(loadFlightCompletionState(), flightId, customTitle);
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
