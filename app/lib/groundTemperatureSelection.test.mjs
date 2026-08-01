import test from "node:test";
import assert from "node:assert/strict";
import { selectNearestGroundTemperature } from "./weather/openMeteo/groundTemperatureSelection.ts";

const daytimeTimes = ["2026-08-01T20:00", "2026-08-01T21:00"];
const daytimeValues = [14, 13];

for (const [requested, expectedTime, expectedTemperature, expectedOffset] of [
  ["2026-08-01T20:10:00.000Z", "2026-08-01T20:00:00.000Z", 14, -10],
  ["2026-08-01T20:29:00.000Z", "2026-08-01T20:00:00.000Z", 14, -29],
  ["2026-08-01T20:31:00.000Z", "2026-08-01T21:00:00.000Z", 13, 29],
  ["2026-08-01T20:59:00.000Z", "2026-08-01T21:00:00.000Z", 13, 1],
]) {
  test(`${requested.slice(11, 16)} sélectionne l'échéance horaire la plus proche`, () => {
    assert.deepEqual(selectNearestGroundTemperature(requested, daytimeTimes, daytimeValues), {
      validTime: expectedTime,
      temperatureC: expectedTemperature,
      offsetMinutes: expectedOffset,
    });
  });
}

test("23:40 sélectionne 00:00 le jour suivant lorsqu'il est disponible", () => {
  assert.deepEqual(
    selectNearestGroundTemperature(
      "2026-08-01T23:40:00.000Z",
      ["2026-08-01T23:00", "2026-08-02T00:00"],
      [12, 11],
    ),
    { validTime: "2026-08-02T00:00:00.000Z", temperatureC: 11, offsetMinutes: 20 },
  );
});

test("une égalité sélectionne l'échéance future", () => {
  assert.equal(
    selectNearestGroundTemperature("2026-08-01T20:30:00.000Z", daytimeTimes, daytimeValues)?.validTime,
    "2026-08-01T21:00:00.000Z",
  );
});

test("une série absente ou NaN reste indisponible", () => {
  assert.equal(selectNearestGroundTemperature("2026-08-01T20:10:00.000Z", [], []), null);
  assert.equal(selectNearestGroundTemperature("2026-08-01T20:10:00.000Z", ["2026-08-01T20:00"], [Number.NaN]), null);
});
