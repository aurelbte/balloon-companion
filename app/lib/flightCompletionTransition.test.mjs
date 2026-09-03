import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import {
  findJournalFlightBySourceId,
  loadFlightCompletionState,
  reconcileRecordedFlightJournalProjection,
} from "./flightCompletionStorage.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";
import {
  setRuntimeAuthSnapshot,
  setRuntimeGuestModeActive,
} from "./auth/dataScopeRuntime.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("reconstruction exacte et idempotente d'une projection Journal manquante", async () => {
  globalThis.window = { localStorage: memoryStorage(), dispatchEvent: () => true };
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  const recorded = finalizeRecordedFlight(createRecordedFlight({ id: "flight-to-reconcile", startedAt: 1_000 }), 61_000);
  let reads = 0;
  const storage = { getFlight: async (id) => { reads += 1; return id === recorded.id ? recorded : null; } };

  const first = await reconcileRecordedFlightJournalProjection(recorded.id, storage);
  const second = await reconcileRecordedFlightJournalProjection(recorded.id, storage);

  assert.equal(first.status, "RECONSTRUCTED");
  assert.equal(second.status, "PRESENT");
  assert.equal(reads, 1);
  assert.deepEqual(loadFlightCompletionState().journalFlights.map(({ sourceFlightId }) => sourceFlightId), [recorded.id]);
  delete globalThis.window;
});

test("la reconstruction respecte les namespaces USER et GUEST", async () => {
  globalThis.window = { localStorage: memoryStorage(), dispatchEvent: () => true };
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  const recorded = finalizeRecordedFlight(createRecordedFlight({ id: "guest-flight", startedAt: 1_000 }), 61_000);
  await reconcileRecordedFlightJournalProjection(recorded.id, { getFlight: async () => recorded });

  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-b", email: "b@example.test", firstName: "", lastName: "" } });
  const result = await reconcileRecordedFlightJournalProjection(recorded.id, { getFlight: async () => null });

  assert.equal(result.status, "NOT_FOUND");
  assert.equal(loadFlightCompletionState().journalFlights.length, 0);
  delete globalThis.window;
});

test("l'ordre du tableau ne change jamais le vol résolu par son ID", () => {
  const first = recordedFlightToJournalFlight(finalizeRecordedFlight(createRecordedFlight({ id: "first", startedAt: 1_000 }), 61_000));
  const requested = recordedFlightToJournalFlight(finalizeRecordedFlight(createRecordedFlight({ id: "requested", startedAt: 2_000 }), 62_000));
  const last = recordedFlightToJournalFlight(finalizeRecordedFlight(createRecordedFlight({ id: "last", startedAt: 3_000 }), 63_000));
  assert.equal(findJournalFlightBySourceId({ journalFlights: [last, first, requested] }, "requested")?.id, "requested");
});

test("un scope indisponible ou changé pendant la lecture n'écrit aucune projection", async () => {
  globalThis.window = { localStorage: memoryStorage(), dispatchEvent: () => true };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "UNKNOWN", user: null });
  assert.equal((await reconcileRecordedFlightJournalProjection("flight", { getFlight: async () => null })).status, "SCOPE_UNAVAILABLE");

  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-a", email: "a@example.test", firstName: "", lastName: "" } });
  const recorded = finalizeRecordedFlight(createRecordedFlight({ id: "flight", startedAt: 1_000 }), 61_000);
  let release;
  const read = new Promise((resolve) => { release = resolve; });
  const reconciliation = reconcileRecordedFlightJournalProjection("flight", { getFlight: async () => read });
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-b", email: "b@example.test", firstName: "", lastName: "" } });
  release(recorded);

  assert.equal((await reconciliation).status, "SCOPE_CHANGED");
  assert.equal(loadFlightCompletionState().journalFlights.length, 0);
  delete globalThis.window;
});
