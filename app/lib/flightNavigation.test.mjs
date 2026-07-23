import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_NAVIGATION_ITEMS,
  getFlightNavigationIntent,
  resolveFlightNavigationAction,
} from "./flightNavigation.ts";
import { createRecordedFlight } from "./recordedFlight.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";

test("Journal construit l’URL /flights", () => {
  assert.equal(
    MAIN_NAVIGATION_ITEMS.find((item) => item.label === "Journal")?.href,
    "/flights",
  );
});

test("la navigation est libre sans vol actif", () => {
  assert.deepEqual(
    getFlightNavigationIntent({
      target: "/flights",
      isFlightRecording: false,
    }),
    { kind: "NAVIGATE", target: "/flights" },
  );
});

test("la navigation est interceptée avec un vol actif", () => {
  assert.deepEqual(
    getFlightNavigationIntent({
      target: "/flights",
      isFlightRecording: true,
    }),
    { kind: "CONFIRM", target: "/flights" },
  );
});

test("RESTER annule la destination", () => {
  assert.deepEqual(
    resolveFlightNavigationAction({
      action: "STAY",
      pendingTarget: "/flights",
    }),
    { navigateTo: null, shouldFinalize: false, pendingTarget: null },
  );
});

test("QUITTER conserve le vol et retourne la destination", () => {
  assert.deepEqual(
    resolveFlightNavigationAction({
      action: "CONTINUE",
      pendingTarget: "/flights",
    }),
    {
      navigateTo: "/flights",
      shouldFinalize: false,
      pendingTarget: null,
    },
  );
});

test("ARRÊTER demande une unique finalisation", () => {
  assert.deepEqual(
    resolveFlightNavigationAction({
      action: "FINALIZE",
      pendingTarget: "/",
    }),
    { navigateTo: "/", shouldFinalize: true, pendingTarget: null },
  );
});

test("QUITTER conserve activeFlight et son identifiant", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const activeFlight = createRecordedFlight({
    id: "same-flight",
    startedAt: 1_000,
  });
  await storage.saveActiveFlight(activeFlight);
  resolveFlightNavigationAction({
    action: "CONTINUE",
    pendingTarget: "/flights",
  });
  const afterNavigation = await storage.getActiveFlight();
  assert.equal(afterNavigation?.id, "same-flight");
  assert.equal(afterNavigation?.startedAt, 1_000);
});
