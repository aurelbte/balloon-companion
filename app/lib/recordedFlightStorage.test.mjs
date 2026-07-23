import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";

test("persiste, reprend puis finalise un vol via l’abstraction de stockage", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const flight = createRecordedFlight({ id: "flight", startedAt: 1_000 });
  await storage.saveActiveFlight(flight);

  const restored = await storage.getActiveFlight();
  assert.equal(restored?.id, "flight");
  assert.notEqual(restored, flight);

  const completed = finalizeRecordedFlight(restored, 2_000);
  await storage.completeFlight(completed);
  assert.equal(await storage.getActiveFlight(), null);
  assert.equal((await storage.getFlight("flight"))?.status, "COMPLETED");
  assert.deepEqual(
    (await storage.listFlights()).map((item) => item.id),
    ["flight"],
  );
  assert.equal(await storage.getFlight("inconnu"), null);
  assert.equal((await storage.getFlight("flight"))?.id, "flight");
});

test("abandonne uniquement le vol actif", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const completed = finalizeRecordedFlight(
    createRecordedFlight({ id: "saved", startedAt: 1_000 }),
    2_000,
  );
  await storage.completeFlight(completed);
  await storage.saveActiveFlight(
    createRecordedFlight({ id: "active", startedAt: 3_000 }),
  );
  await storage.clearActiveFlight();
  assert.equal(await storage.getActiveFlight(), null);
  assert.equal((await storage.getFlight("saved"))?.id, "saved");
});
