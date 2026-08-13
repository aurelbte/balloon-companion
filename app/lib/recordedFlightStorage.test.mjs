import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";

test("persiste, reprend puis finalise un vol via l’abstraction de stockage", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const weatherSnapshot = {
    version: 1, weatherModel: "arome_seamless", modelLabel: "AROME",
    referenceLocation: { name: "LFQO", latitude: 50.68, longitude: 3.08, terrainAltitudeAmslM: 20 },
    forecastAtIso: "2026-08-13T12:00:00Z", sourceUpdatedAt: "2026-08-13T11:00:00Z",
    windProfile: [{ levelM: 300, altitudeAmslM: 300, directionFromDeg: 120, speedMps: 3 }],
  };
  const flight = createRecordedFlight({ id: "flight", startedAt: 1_000, weatherModel: "arome_seamless", weatherSnapshot });
  await storage.saveActiveFlight(flight);

  const restored = await storage.getActiveFlight();
  assert.equal(restored?.id, "flight");
  assert.equal(restored?.weatherModel, "arome_seamless");
  assert.deepEqual(restored?.weatherSnapshot, weatherSnapshot);
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

test("un nouveau vol sans préparation ne reprend pas le modèle précédent", () => {
  const previous = createRecordedFlight({ id: "previous", weatherModel: "arome_seamless" });
  const next = createRecordedFlight({ id: "next" });
  assert.equal(previous.weatherModel, "arome_seamless");
  assert.equal(next.weatherModel, undefined);
});

test("supprime définitivement une trace terminée du stockage", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const completed = finalizeRecordedFlight(createRecordedFlight({ id: "delete-me", startedAt: 1_000 }), 2_000);
  await storage.completeFlight(completed);
  assert.ok(await storage.getFlight("delete-me"));
  await storage.deleteFlight("delete-me");
  assert.equal(await storage.getFlight("delete-me"), null);
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
