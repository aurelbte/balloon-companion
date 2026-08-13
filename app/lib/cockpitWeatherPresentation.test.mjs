import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cockpitWindDirection, cockpitWindSpeed } from "../components/cockpit/weatherCardPresentation.ts";

test("convertit les angles dans les 16 secteurs en conservant l'angle exact", () => {
  const expected = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  assert.deepEqual(expected.map((_, index) => cockpitWindDirection(index * 22.5).split(" · ")[0]), expected);
  assert.equal(cockpitWindDirection(114), "ESE · 114°");
});

test("arrondit uniquement les vitesses affichées sur le Cockpit", () => {
  assert.deepEqual([6.3, 6.4, 6.6, 11.5].map(cockpitWindSpeed), ["6 km/h", "6 km/h", "7 km/h", "12 km/h"]);
  const weatherPage = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(weatherPage, /valueOrDash\(slot\.windSpeedKmh, " km\/h"\)/);
  assert.doesNotMatch(weatherPage, /cockpitWindSpeed/);
});
