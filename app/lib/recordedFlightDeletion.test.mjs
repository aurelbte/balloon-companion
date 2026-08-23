import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight } from "./recordedFlight.ts";
import { deleteRecordedFlightWithCloudMutation } from "./recordedFlightStorage.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

function recordedFlight(id = "flight-delete-target") {
  return createRecordedFlight({ id, startedAt: Date.UTC(2026, 7, 22, 8) });
}

function deletionHarness(scope, input = {}) {
  const flight = recordedFlight();
  const flights = new Map([[flight.id, flight]]);
  let mutationNumber = 0;
  const outbox = new MemorySyncOutboxStorage({ dependencies: {
    createId: () => `mutation-${++mutationNumber}`,
    now: () => "2026-08-22T08:05:00.000Z",
  } });
  let enqueueCalls = 0;
  let syncCalls = 0;
  const remove = () => deleteRecordedFlightWithCloudMutation({
    id: flight.id,
    previous: flights.get(flight.id) ?? null,
    scope,
    deleteLocal: async () => { flights.delete(flight.id); },
    restoreLocal: async (previous) => { flights.set(previous.id, previous); },
    enqueueDelete: async () => {
      enqueueCalls += 1;
      if (input.enqueueFails) return false;
      await outbox.enqueue({ entityType: "flight", entityId: flight.id, operation: "DELETE" });
      return true;
    },
  });
  return { flight, flights, outbox, remove, enqueueCalls: () => enqueueCalls, syncCalls: () => syncCalls };
}

test("USER supprime localement un RecordedFlight et persiste un unique DELETE flight", async () => {
  const harness = deletionHarness("USER:user-id");
  await harness.outbox.enqueue({ entityType: "flight", entityId: "flight-A", operation: "DELETE" });
  const upsertB = await harness.outbox.enqueue({ entityType: "flight", entityId: harness.flight.id, operation: "UPSERT" });
  await harness.remove();
  await harness.remove();

  assert.equal(harness.flights.has(harness.flight.id), false);
  const deletes = (await harness.outbox.list()).filter(({ entityType, operation }) => entityType === "flight" && operation === "DELETE");
  assert.deepEqual(deletes.map(({ entityId }) => entityId), ["flight-A", harness.flight.id]);
  assert.equal(deletes.filter(({ entityId }) => entityId === harness.flight.id).length, 1);
  assert.equal(deletes.find(({ entityId }) => entityId === harness.flight.id)?.mutationId, upsertB.mutationId);
  assert.equal("payload" in deletes[1], false);
  assert.equal(harness.syncCalls(), 0);
});

test("USER restaure le RecordedFlight si l’enqueue DELETE échoue", async () => {
  const harness = deletionHarness("USER:user-id", { enqueueFails: true });
  await assert.rejects(harness.remove(), /Mutation flight DELETE non persistée/);
  assert.equal(harness.flights.get(harness.flight.id), harness.flight);
  assert.deepEqual(await harness.outbox.list(), []);
});

test("GUEST conserve la suppression locale sans exiger la mutation Cloud", async () => {
  const harness = deletionHarness("GUEST", { enqueueFails: true });
  await harness.remove();
  assert.equal(harness.flights.has(harness.flight.id), false);
  assert.equal(harness.enqueueCalls(), 1);
  assert.deepEqual(await harness.outbox.list(), []);
  assert.equal(harness.syncCalls(), 0);
});
