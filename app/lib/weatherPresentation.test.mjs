import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const presentation = readFileSync(new URL("../weather/presentation.tsx", import.meta.url), "utf8");

test("associe les familles météo aux pictogrammes standards et conserve les libellés", () => {
  for (const mapping of ['CLEAR: "sun"', 'MAINLY_CLEAR: "sun-cloud"', 'OVERCAST: "cloud"', 'LIGHT_DRIZZLE: "drizzle"', 'LIGHT_RAIN: "rain"', 'FOG: "fog"', 'LIGHT_SNOW: "snow"', 'THUNDERSTORM: "storm"']) assert.ok(presentation.includes(mapping), mapping);
  for (const label of ["Ciel dégagé", "Principalement dégagé", "Couvert", "Bruine faible", "Pluie faible", "Brouillard", "Neige faible", "Orage"]) assert.ok(presentation.includes(label), label);
});

test("rattache le libellé au pictogramme sans altérer les valeurs de la page météo", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(page, /conditionFocus}><WeatherIcon code=\{slot\.weatherCode\}/);
  assert.match(page, /WEATHER_LABELS\[slot\.weatherCode\]/);
  assert.match(page, /valueOrDash\(slot\.windSpeedKmh, " km\/h"\)/);
  assert.match(page, /valueOrDash\(slot\.windGustKmh, " km\/h"\)/);
  assert.match(page, /valueOrDash\(slot\.temperatureC, "°C"\)/);
  assert.doesNotMatch(page, /Math\.round\(slot\./);
});

test("place lever et coucher dans les informations secondaires de la prévision", () => {
  assert.match(readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8"), /label: "Lever"[\s\S]*label: "Coucher"/);
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(page, /sunTimes=\{preferences\.sunTimes\}/);
  assert.doesNotMatch(page, /sunBlock|Lever —|Coucher —/);
});
