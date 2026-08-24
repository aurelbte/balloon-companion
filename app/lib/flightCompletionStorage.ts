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
  roundJournalAltitudeMeters,
  setJournalFlightLogbookStatus,
  setJournalFlightCustomTitle,
  setJournalFlightNotes,
  updateOfficialAscension,
} from "./flightCompletion.ts";
import { buildGeneratedFlightTitle } from "./journalFlightTitle.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";
import { legacyFlightSessionToRecordedFlight } from "./realFlightJournal.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { loadFlightSession } from "./flightSessionStorage.ts";
import { getRuntimeDataScope, readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";
import { qualificationEventsAfterAscensionRemoval, reconcileQualificationEventForAscension } from "./officialAscensionQualifications.ts";
import { loadPilotQualifications, savePilotQualifications } from "./pilotQualificationsStorage.ts";

export const FLIGHT_COMPLETION_STORAGE_KEY = "balloon-companion-flight-completion-v1";
const STORAGE_KEY = FLIGHT_COMPLETION_STORAGE_KEY;
export const FLIGHT_COMPLETION_EVENT = "balloon-companion-flight-completion-changed";

type JournalFlightCloudMutation = Readonly<{
  entityId: string;
  operation: "UPSERT" | "DELETE";
}>;

type OfficialAscensionCloudMutation = Readonly<{
  entityId: string;
  operation: "UPSERT" | "DELETE";
}>;

function lightweightJournalFlight(flight: CompletionJournalFlight): CompletionJournalFlight {
  return { ...flight, sourceFlightId: flight.sourceFlightId ?? flight.id, points: [] };
}

export function journalFlightCloudMutations(
  previous: readonly CompletionJournalFlight[],
  next: readonly CompletionJournalFlight[],
): JournalFlightCloudMutation[] {
  const previousById = new Map(previous.map((flight) => {
    const lightweight = lightweightJournalFlight(flight);
    return [lightweight.sourceFlightId!, lightweight] as const;
  }));
  const nextById = new Map(next.map((flight) => {
    const lightweight = lightweightJournalFlight(flight);
    return [lightweight.sourceFlightId!, lightweight] as const;
  }));
  const removed = [...previousById.keys()]
    .filter((entityId) => !nextById.has(entityId))
    .map((entityId) => ({ entityId, operation: "DELETE" as const }));
  const upserted = [...nextById.entries()]
    .filter(([entityId, flight]) => JSON.stringify(previousById.get(entityId)) !== JSON.stringify(flight))
    .map(([entityId]) => ({ entityId, operation: "UPSERT" as const }));
  return [...removed, ...upserted];
}

export function officialAscensionCloudMutations(
  previous: readonly OfficialAscension[],
  next: readonly OfficialAscension[],
): OfficialAscensionCloudMutation[] {
  const previousById = new Map(previous.map((ascension) => [ascension.id, ascension] as const));
  const nextById = new Map(next.map((ascension) => [ascension.id, ascension] as const));
  const removed = [...previousById.keys()]
    .filter((entityId) => !nextById.has(entityId))
    .map((entityId) => ({ entityId, operation: "DELETE" as const }));
  const upserted = [...nextById.entries()]
    .filter(([entityId, ascension]) => JSON.stringify(previousById.get(entityId)) !== JSON.stringify(ascension))
    .map(([entityId]) => ({ entityId, operation: "UPSERT" as const }));
  return [...removed, ...upserted];
}

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
        maxAltitudeM: roundJournalAltitudeMeters(flight.maxAltitudeM),
        ...(flight.statistics ? { statistics: {
          ...flight.statistics,
          takeoffAltitudeAmslM: roundJournalAltitudeMeters(flight.statistics.takeoffAltitudeAmslM),
          landingAltitudeAmslM: roundJournalAltitudeMeters(flight.statistics.landingAltitudeAmslM),
          averageAltitudeAmslM: roundJournalAltitudeMeters(flight.statistics.averageAltitudeAmslM),
        } } : {}),
        generatedTitle,
        ...(customTitle ? { customTitle } : {}),
        title: undefined,
        logbookStatus: legacyStatus === "VALIDATED" ? "CARNET_VALIDATED"
          : legacyStatus === "JOURNAL_ONLY" ? "JOURNAL_ONLY"
          : legacyStatus === "CARNET_VALIDATED" ? "CARNET_VALIDATED"
          : "CARNET_PENDING",
      };
    }),
    officialAscensions: state.officialAscensions.map((ascension) => ({
      ...ascension,
      ...(ascension.maximumAltitudeM === null || typeof ascension.maximumAltitudeM === "number"
        ? { maximumAltitudeM: roundJournalAltitudeMeters(ascension.maximumAltitudeM) } : {}),
    })),
  };
}

export function loadFlightCompletionState(): FlightCompletionState {
  if (typeof window === "undefined") return createEmptyFlightCompletionState();
  const scope = getRuntimeDataScope();
  const blank: FlightCompletionState = { version: FLIGHT_COMPLETION_SCHEMA_VERSION, openingBalance: scope === "GUEST" ? { confirmed: true, ascensions: 0, officialDurationMinutes: 0 } : { confirmed: false, ascensions: null, officialDurationMinutes: null }, journalFlights: [], officialAscensions: [] };
  if (!scope) return blank;
  try {
    const raw = readScopedBusinessValue(window.localStorage, STORAGE_KEY);
    if (!raw) return blank;
    const value: unknown = JSON.parse(raw ?? "null");
    return normalizeState(value) ?? blank;
  } catch {
    return blank;
  }
}

export type CloudFlightJournalMetadata = Readonly<{
  customTitle: string | null;
  origin: CompletionJournalFlight["origin"];
  logbookStatus: CompletionJournalFlight["logbookStatus"];
  recovered: boolean;
}>;

/** Pull-only Journal projection; it preserves official ascensions and never enqueues. */
export function applyRecordedFlightToJournalFromCloudWithoutEnqueue(
  scope: `USER:${string}`,
  id: string,
  flight: RecordedFlight | null,
  metadata: CloudFlightJournalMetadata | null,
  storage: Storage = window.localStorage,
): boolean {
  if (typeof window === "undefined" || getRuntimeDataScope() !== scope) return false;
  const current = loadFlightCompletionState();
  const retained = current.journalFlights.filter(({ sourceFlightId, id: localId }) => (sourceFlightId ?? localId) !== id);
  let journalFlights = retained;
  if (flight && metadata) {
    const projected = recordedFlightToJournalFlight(flight);
    journalFlights = [...retained, {
      ...projected,
      ...(metadata.customTitle ? { customTitle: metadata.customTitle } : {}),
      origin: metadata.origin,
      logbookStatus: metadata.logbookStatus,
      ...(metadata.recovered ? { recovered: true } : {}),
    }];
  }
  const next: FlightCompletionState = { ...current, journalFlights };
  if (!writeScopedBusinessValue(storage, STORAGE_KEY, JSON.stringify(next))) return false;
  window.dispatchEvent(new Event(FLIGHT_COMPLETION_EVENT));
  return true;
}

export function hasOfficialAscensionSourceFlightConflict(id: string, sourceFlightId: string | null): boolean {
  if (!sourceFlightId) return false;
  return loadFlightCompletionState().officialAscensions.some((ascension) => ascension.id !== id && ascension.sourceFlightId === sourceFlightId);
}

/** Pull-only OfficialAscension hydration; no qualification reconciliation and no enqueue. */
export function applyOfficialAscensionFromCloudWithoutEnqueue(
  scope: `USER:${string}`,
  id: string,
  ascension: OfficialAscension | null,
  storage: Storage = window.localStorage,
): boolean {
  if (typeof window === "undefined" || getRuntimeDataScope() !== scope) return false;
  if (ascension && hasOfficialAscensionSourceFlightConflict(id, ascension.sourceFlightId)) return false;
  const current = loadFlightCompletionState();
  let persistedBase: FlightCompletionState = current;
  try {
    const raw = JSON.parse(readScopedBusinessValue(storage, STORAGE_KEY) ?? "null") as Partial<FlightCompletionState> | null;
    if (raw && typeof raw === "object" && Array.isArray(raw.journalFlights) && Array.isArray(raw.officialAscensions) && raw.openingBalance) {
      persistedBase = raw as FlightCompletionState;
    }
  } catch {}
  const retained = current.officialAscensions.filter((item) => item.id !== id);
  const officialAscensions = ascension ? [...retained, ascension] : retained;
  if (!writeScopedBusinessValue(storage, STORAGE_KEY, JSON.stringify({ ...persistedBase, officialAscensions } satisfies FlightCompletionState))) return false;
  window.dispatchEvent(new Event(FLIGHT_COMPLETION_EVENT));
  return true;
}

/** Pull-only opening balance hydration used by the Cloud profile singleton. */
export function applyOpeningBalanceFromCloudWithoutEnqueue(
  scope: `USER:${string}`,
  openingBalance: FlightCompletionState["openingBalance"],
  storage: Storage = window.localStorage,
): boolean {
  if (typeof window === "undefined" || getRuntimeDataScope() !== scope) return false;
  const current = loadFlightCompletionState();
  if (!writeScopedBusinessValue(storage, STORAGE_KEY, JSON.stringify({ ...current, openingBalance } satisfies FlightCompletionState))) return false;
  window.dispatchEvent(new Event(FLIGHT_COMPLETION_EVENT));
  return true;
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

function persistQualificationLink(ascension: OfficialAscension | undefined): void {
  if (!ascension || typeof window === "undefined") return;
  const qualifications = loadPilotQualifications(window.localStorage);
  const link = reconcileQualificationEventForAscension(ascension, qualifications.events);
  if (link.status === "CREATED" || link.status === "UPDATED") {
    savePilotQualifications({ profile: qualifications.profile, events: link.events }, window.localStorage);
  }
}

export function persistManualOfficialAscension(
  input: OfficialAscensionInput,
): FlightCompletionState {
  const id = createManualAscensionId();
  const state = addManualOfficialAscension(
    loadFlightCompletionState(),
    id,
    input,
  );
  saveFlightCompletionState(state);
  persistQualificationLink(state.officialAscensions.find((ascension) => ascension.id === id));
  return state;
}

export function saveFlightCompletionState(state: FlightCompletionState): boolean {
  if (typeof window === "undefined") return false;
  try {
    const previousState = loadFlightCompletionState();
    const previousAscensionIds = new Set(previousState.officialAscensions.map(({ id }) => id));
    const nextAscensionIds = new Set(state.officialAscensions.map(({ id }) => id));
    const removedAscensionIds = [...previousAscensionIds].filter((id) => !nextAscensionIds.has(id));
    const lightweightState: FlightCompletionState = {
      ...state,
      journalFlights: state.journalFlights.map(lightweightJournalFlight),
    };
    if (!writeScopedBusinessValue(window.localStorage, STORAGE_KEY, JSON.stringify(lightweightState))) return false;
    enqueueLocalSyncMutation("flight-completion", "singleton");
    for (const mutation of journalFlightCloudMutations(previousState.journalFlights, lightweightState.journalFlights)) {
      enqueueLocalSyncMutation("flight", mutation.entityId, mutation.operation);
    }
    for (const mutation of officialAscensionCloudMutations(previousState.officialAscensions, lightweightState.officialAscensions)) {
      enqueueLocalSyncMutation("logbook-entry", mutation.entityId, mutation.operation);
    }
    if (removedAscensionIds.length) {
      const qualifications = loadPilotQualifications(window.localStorage);
      const retained = removedAscensionIds.reduce(
        (events, ascensionId) => qualificationEventsAfterAscensionRemoval(ascensionId, events).events,
        qualifications.events,
      );
      if (retained !== qualifications.events) savePilotQualifications({ profile: qualifications.profile, events: retained }, window.localStorage);
    }
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
  persistQualificationLink(state.officialAscensions.find(({ sourceFlightId: linkedFlightId }) => linkedFlightId === sourceFlightId));
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
  persistQualificationLink(updated);
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

export function persistJournalFlightNotes(
  flightId: string,
  notes: string | null,
): FlightCompletionState {
  const normalizedNotes = notes?.trim() || null;
  const state = setJournalFlightNotes(loadFlightCompletionState(), flightId, normalizedNotes);
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
