import assert from "node:assert/strict";
import test from "node:test";
import { createDemoCompletionJournalFlight, createEmptyFlightCompletionState } from "./flightCompletion.ts";
import { loadFlightCompletionState, saveFlightCompletionState } from "./flightCompletionStorage.ts";
import { latestRealJournalFlight } from "./realFlightJournal.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

const user = { id: "cockpit-user", email: "pilot@example.com", firstName: "", lastName: "" };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("le Cockpit ignore le faux vol et conserve le dernier vrai vol par scope", () => {
  globalThis.window = { localStorage: storage(), dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  const demo = createDemoCompletionJournalFlight();
  saveFlightCompletionState({ ...createEmptyFlightCompletionState(), journalFlights: [demo] });
  assert.equal(latestRealJournalFlight(loadFlightCompletionState().journalFlights), null);

  const real = { ...demo, id: "real-user-flight", sourceFlightId: "real-user-flight", origin: "REAL_GPS", date: "12 août 2026", dateIso: "2026-08-12", departure: "Terrain A", arrival: "Terrain B" };
  saveFlightCompletionState({ ...createEmptyFlightCompletionState(), journalFlights: [demo, real] });
  assert.equal(latestRealJournalFlight(loadFlightCompletionState().journalFlights)?.id, real.id);

  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(latestRealJournalFlight(loadFlightCompletionState().journalFlights), null);

  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  assert.equal(latestRealJournalFlight(loadFlightCompletionState().journalFlights)?.id, real.id);
  delete globalThis.window;
});
