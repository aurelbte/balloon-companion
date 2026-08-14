import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import {
  DEFAULT_UNIT_PREFERENCES,
  celsiusToFahrenheit,
  feetToMetres,
  formatFlightAltitude,
  formatFlightDistance,
  formatFlightSpeed,
  formatWeatherTemperature,
  formatWeatherWind,
  kilometresToNauticalMiles,
  kmhToKnots,
  metresToFeet,
  nauticalMilesToKilometres,
  preserveOfficialAviationUnit,
} from "./unitPreferences.ts";
import { loadUnitPreferences, saveUnitPreferences } from "./unitPreferencesStorage.ts";

const user = (id) => ({ id, email: `${id}@example.com`, firstName: "", lastName: "" });
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("les valeurs par défaut conservent les unités françaises actuelles", () => {
  globalThis.localStorage = storage();
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("default") });
  assert.deepEqual(loadUnitPreferences(), DEFAULT_UNIT_PREFERENCES);
  delete globalThis.localStorage;
});

test("les unités météo et instruments restent indépendantes et persistantes", () => {
  globalThis.localStorage = storage();
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("pilot") });
  saveUnitPreferences({ weather: { windSpeedUnit: "kt", temperatureUnit: "°F" }, flightInstruments: { speedUnit: "km/h", altitudeUnit: "ft", distanceUnit: "NM" } });
  assert.deepEqual(loadUnitPreferences(), { weather: { windSpeedUnit: "kt", temperatureUnit: "°F" }, flightInstruments: { speedUnit: "km/h", altitudeUnit: "ft", distanceUnit: "NM" } });
  delete globalThis.localStorage;
});

test("les conversions et formatters centraux sont exacts sans modifier les sources", () => {
  assert.equal(kmhToKnots(18.52), 10);
  assert.ok(Math.abs(metresToFeet(100) - 328.0839895) < 1e-7);
  assert.ok(Math.abs(feetToMetres(328.0839895) - 100) < 1e-7);
  assert.equal(kilometresToNauticalMiles(18.52), 10);
  assert.equal(nauticalMilesToKilometres(10), 18.52);
  assert.equal(celsiusToFahrenheit(20), 68);
  assert.equal(formatWeatherWind(18.52, "kt"), "10 kt");
  assert.equal(formatWeatherTemperature(20, "°F"), "68 °F");
  assert.equal(formatFlightSpeed(18.52, "kt"), "10 kt");
  assert.equal(formatFlightAltitude(100, "ft"), "328 ft");
  assert.equal(formatFlightDistance(18.52, "NM"), "10.0 NM");
});

test("USER et GUEST restaurent strictement leurs propres préférences", () => {
  globalThis.localStorage = storage();
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  saveUnitPreferences({ weather: { windSpeedUnit: "kt", temperatureUnit: "°F" }, flightInstruments: { speedUnit: "kt", altitudeUnit: "ft", distanceUnit: "NM" } });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.deepEqual(loadUnitPreferences(), DEFAULT_UNIT_PREFERENCES);
  saveUnitPreferences({ ...DEFAULT_UNIT_PREFERENCES, weather: { ...DEFAULT_UNIT_PREFERENCES.weather, temperatureUnit: "°F" } });
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  assert.deepEqual(loadUnitPreferences().flightInstruments, { speedUnit: "kt", altitudeUnit: "ft", distanceUnit: "NM" });
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("B") });
  assert.deepEqual(loadUnitPreferences(), DEFAULT_UNIT_PREFERENCES);
  delete globalThis.localStorage;
});

test("les conventions aéronautiques officielles restent hors des préférences pilote", () => {
  assert.equal(preserveOfficialAviationUnit("SFC → 2500 ft"), "SFC → 2500 ft");
  assert.equal(preserveOfficialAviationUnit("1500 ft → FL65"), "1500 ft → FL65");
  const settings = readFileSync(new URL("../more/settings/units/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /données aéronautiques officielles conservent leurs unités d’origine/);
});
