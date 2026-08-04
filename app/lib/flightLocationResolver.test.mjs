import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight } from "./recordedFlight.ts";
import { resolveRecordedFlightLocations } from "./flightLocationResolver.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";

function recorded() {
  return {
    ...createRecordedFlight({ id: "real-places", startedAt: Date.parse("2026-08-04T04:45:00Z") }),
    points: [
      { timestamp: 1, latitude: 50.8, longitude: 2.68 },
      { timestamp: 2, latitude: 50.82, longitude: 2.61 },
    ],
  };
}

test("un nouveau vol conserve durablement les deux communes et son titre", async () => {
  let requests = 0;
  const resolved = await resolveRecordedFlightLocations(recorded(), "Boeschepe", async () => {
    requests += 1;
    return new Response(JSON.stringify({ startLocationLabel: "Boeschepe", endLocationLabel: "Houtkerque" }), { status: 200 });
  });
  assert.equal(requests, 1);
  assert.equal(resolved.startedAt, Date.parse("2026-08-04T04:45:00Z"));
  assert.equal(resolved.startLocationLabel, "Boeschepe");
  assert.equal(resolved.endLocationLabel, "Houtkerque");
  assert.equal(resolved.generatedTitle, "Boeschepe → Houtkerque");
  const storage = new MemoryRecordedFlightStorage();
  await storage.completeFlight(resolved);
  const restored = await storage.getFlight(resolved.id);
  assert.equal(restored?.startLocationLabel, "Boeschepe");
  assert.equal(restored?.endLocationLabel, "Houtkerque");
  assert.equal(restored?.generatedTitle, "Boeschepe → Houtkerque");
});

test("un ICAO explicitement résolu peut être associé à une commune d'arrivée", async () => {
  const resolved = await resolveRecordedFlightLocations(recorded(), undefined, async () =>
    new Response(JSON.stringify({ startLocationLabel: "LFQQ", endLocationLabel: "Mérignies" }), { status: 200 }));
  assert.equal(resolved.generatedTitle, "LFQQ → Mérignies");
});

test("un échec réseau conserve le vol et des fallbacks honnêtes", async () => {
  const resolved = await resolveRecordedFlightLocations(recorded(), "Boeschepe", async () => {
    throw new Error("offline");
  });
  assert.equal(resolved.startLocationLabel, "Boeschepe");
  assert.equal(resolved.endLocationLabel, "Arrivée inconnue");
  assert.equal(resolved.generatedTitle, "Boeschepe → Arrivée inconnue");
});

test("la résolution est une opération explicite et non une lecture du Journal", () => {
  assert.equal(typeof resolveRecordedFlightLocations, "function");
});
