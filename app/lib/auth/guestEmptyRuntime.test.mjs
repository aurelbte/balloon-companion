import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./dataScopeRuntime.ts";
import { loadFlightCompletionState } from "../flightCompletionStorage.ts";
import { loadBalloonRegistry } from "../balloonStorage.ts";
import { loadFavoriteLaunchSites } from "../favoriteLaunchSites.ts";
import { loadPilotProfile } from "../pilotProfileStorage.ts";

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), snapshot: () => Object.fromEntries(values) };
}

test("GUEST neuf ignore toutes les données legacy et démarre réellement vide", () => {
  const localStorage = storage({
    "balloon-companion-flight-completion-v1": JSON.stringify({ openingBalance: { confirmed: true, ascensions: 108, officialDurationMinutes: 8195 }, journalFlights: [{ id: "legacy-flight" }], officialAscensions: [] }),
    "balloon-companion-balloons": JSON.stringify({ version: 5, balloons: [{ id: "F-HLFM" }], activeBalloonId: "F-HLFM" }),
    "balloon-companion-pilot-profile": JSON.stringify({ firstName: "Aurélien" }),
    "balloon-companion-favorite-launch-sites-v1": JSON.stringify({ version: 1, favorites: [{ id: "favorite-lfqo" }] }),
  });
  globalThis.window = { localStorage };
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);

  const completion = loadFlightCompletionState();
  assert.deepEqual(completion.openingBalance, { confirmed: true, ascensions: 0, officialDurationMinutes: 0 });
  assert.deepEqual(completion.journalFlights, []);
  assert.deepEqual(loadBalloonRegistry().balloons, []);
  assert.deepEqual(loadFavoriteLaunchSites(), []);
  assert.equal(loadPilotProfile().firstName, "");
  assert.ok(localStorage.getItem("balloon-companion-flight-completion-v1")?.includes("108"));
  delete globalThis.window;
});
