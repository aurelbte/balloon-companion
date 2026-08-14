import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatWeatherTemperature, formatWeatherWind } from "./unitPreferences.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Cockpit et page Météo convertissent vent, rafales et température à l'affichage", () => {
  assert.equal(formatWeatherWind(18.52, "km/h"), "19 km/h");
  assert.equal(formatWeatherWind(18.52, "kt"), "10 kt");
  assert.equal(formatWeatherTemperature(20, "°C"), "20 °C");
  assert.equal(formatWeatherTemperature(20, "°F"), "68 °F");
  for (const file of [source("../components/cockpit/ConditionsCard.tsx"), source("../weather/page.tsx")]) {
    assert.match(file, /useUnitPreferences/);
    assert.match(file, /formatWeatherWind|cockpitWindSpeed/);
    assert.match(file, /formatWeatherTemperature/);
  }
});

test("Prépa convertit uniquement ses températures météo présentées", () => {
  const preparation = source("../map/page.tsx");
  assert.match(preparation, /formatWeatherTemperature/);
  assert.match(preparation, /units\.weather\.temperatureUnit/);
});

test("VENTS applique l'unité météo uniquement au Prévu", () => {
  const panel = source("../components/flight/WindProfilePanel.tsx");
  assert.match(panel, /formatPredictedWind\(predicted\.get\(level\)\)/);
  assert.match(panel, /units\.weather\.windSpeedUnit/);
});

test("la popup convertit les vents sans toucher aux distances ni aux espaces officiels", () => {
  const popup = source("../components/TrajectoryArrivalDetails.tsx");
  assert.match(popup, /formatWeatherWind\(value, units\.weather\.windSpeedUnit\)/);
  assert.match(popup, /formatFlightDistance\(trajectoryDistanceKm\(trace\)/);
  assert.match(popup, /normalizeOpenAipAltitudeLimit/);
});

test("METAR et TAF restent entièrement indépendants des préférences météo", () => {
  const page = source("../weather/page.tsx");
  const aviation = page.slice(page.indexOf("function TafPeriod"), page.indexOf("function AviationAirportPicker"));
  assert.match(aviation, /metarDisplay/);
  assert.match(aviation, /tafPeriods/);
  assert.doesNotMatch(aviation, /useUnitPreferences|formatWeatherWind|formatWeatherTemperature|windUnit|temperatureUnit/);
});

test("les données sources météo ne sont ni mutées ni réécrites", () => {
  const files = [source("../components/cockpit/ConditionsCard.tsx"), source("../weather/page.tsx"), source("../components/TrajectoryArrivalDetails.tsx")];
  assert.ok(files.every((file) => !/(?:windSpeedKmh|temperatureC|windGustKmh)\s*=(?!=)/.test(file)));
});
