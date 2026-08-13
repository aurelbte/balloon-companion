import assert from "node:assert/strict";
import test from "node:test";
import { REGISTERED_BALLOONS } from "../balloons.ts";
import { loadBalloonRegistry, saveBalloonRegistry } from "../balloonStorage.ts";
import { loadFavoriteLaunchSites, saveFavoriteLaunchSites } from "../favoriteLaunchSites.ts";
import { loadFlightCompletionState } from "../flightCompletionStorage.ts";
import { loadPilotProfile, savePilotProfile } from "../pilotProfileStorage.ts";
import { loadWeatherPreferences, saveWeatherPreferences } from "../weatherPreferencesStorage.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./dataScopeRuntime.ts";

const user = { id: "pilot-123", email: "pilot@example.com", firstName: "Pilote", lastName: "Test" };
const userFavorite = { id: "user-place", name: "Terrain USER", latitude: 50.7, longitude: 3.1, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" };
const guestFavorite = { id: "guest-place", name: "Terrain GUEST", latitude: 48.8, longitude: 2.3, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" };

function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("logout, GUEST et reconnexion conservent des données strictement isolées", () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  saveWeatherPreferences({ favoriteWeatherLocationId: userFavorite.id, weatherModel: "arome_seamless" });
  saveFavoriteLaunchSites([userFavorite]);
  saveBalloonRegistry({ version: 5, balloons: [REGISTERED_BALLOONS[0]], activeBalloonId: REGISTERED_BALLOONS[0].id });
  savePilotProfile({ version: 1, firstName: "Pilote", lastName: "Test", licenseNumber: "LIC-USER", usualFunction: "Pilote", flightTestDueDateIso: "", medicalDueDateIso: "" });

  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.deepEqual(loadWeatherPreferences(), { favoriteWeatherLocationId: null, weatherModel: null });
  assert.deepEqual(loadFavoriteLaunchSites(), []);
  assert.deepEqual(loadBalloonRegistry().balloons, []);
  assert.equal(loadPilotProfile().firstName, "");
  assert.deepEqual(loadFlightCompletionState().openingBalance, { confirmed: true, ascensions: 0, officialDurationMinutes: 0 });

  saveWeatherPreferences({ favoriteWeatherLocationId: guestFavorite.id, weatherModel: "gfs_seamless" });
  saveFavoriteLaunchSites([guestFavorite]);
  saveBalloonRegistry({ version: 5, balloons: [REGISTERED_BALLOONS[1]], activeBalloonId: REGISTERED_BALLOONS[1].id });
  assert.equal(loadWeatherPreferences().favoriteWeatherLocationId, guestFavorite.id);
  assert.equal(loadBalloonRegistry().activeBalloonId, REGISTERED_BALLOONS[1].id);

  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  assert.deepEqual(loadWeatherPreferences(), { favoriteWeatherLocationId: userFavorite.id, weatherModel: "arome_seamless" });
  assert.deepEqual(loadFavoriteLaunchSites().map(({ id }) => id), [userFavorite.id]);
  assert.equal(loadBalloonRegistry().activeBalloonId, REGISTERED_BALLOONS[0].id);
  assert.equal(loadPilotProfile().licenseNumber, "LIC-USER");

  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(loadWeatherPreferences().favoriteWeatherLocationId, guestFavorite.id);
  assert.equal(loadBalloonRegistry().activeBalloonId, REGISTERED_BALLOONS[1].id);
  delete globalThis.window;
});

test("un registre absent ou invalide n'injecte jamais le catalogue historique", () => {
  globalThis.window = { localStorage: storage(), dispatchEvent() {} };
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.deepEqual(loadBalloonRegistry(), { version: 5, balloons: [], activeBalloonId: null });
  delete globalThis.window;
});
