import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { loadWeatherPreferences, saveWeatherPreferences } from "./weatherPreferencesStorage.ts";

const user = (id) => ({ id, email: `${id}@example.com`, firstName: "", lastName: "" });
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test("persiste et restaure les préférences séparément pour USER et GUEST", () => {
  const localStorage = storage();
  globalThis.window = { localStorage };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  saveWeatherPreferences({ favoriteWeatherLocationId: "site-a", weatherModel: "arome_seamless" });
  assert.deepEqual(loadWeatherPreferences(), { favoriteWeatherLocationId: "site-a", weatherModel: "arome_seamless" });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.deepEqual(loadWeatherPreferences(), { favoriteWeatherLocationId: null, weatherModel: null });
  saveWeatherPreferences({ favoriteWeatherLocationId: "guest-site", weatherModel: "gfs_seamless" });
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  assert.equal(loadWeatherPreferences().favoriteWeatherLocationId, "site-a");
  delete globalThis.window;
});

test("cockpit et page météo consomment le même contexte", () => {
  const sources = ["../weather/page.tsx", "../components/cockpit/ConditionsCard.tsx"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  assert.ok(sources.every((source) => source.includes("useWeatherPreferences")));
  assert.ok(sources.every((source) => source.includes("selectedPoint")));
});

test("le contexte expose la remise au créneau météo courant sans requête dédiée", () => {
  const context = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  assert.match(context, /resetToCurrent/);
  assert.match(context, /closestAvailableDay/);
  assert.match(context, /closestAvailableTime/);
});
