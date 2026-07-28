import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenMeteoWindColumn } from "./weather/openMeteo/parser.ts";
import { interpolateWindAtAltitude } from "./trajectory/interpolation.ts";
import {
  ALTITUDE_COLORS,
  normalizeAltitudeOptions,
} from "./trajectory/integration.ts";
import { WEATHER_MODEL_REGISTRY } from "./weather/models.ts";

function fixture() {
  return {
    latitude: 50.631,
    longitude: 3.058,
    elevation: 26,
    hourly_units: {
      wind_speed_10m: "m/s",
      wind_direction_10m: "°",
      wind_speed_80m: "m/s",
      wind_direction_80m: "°",
      wind_speed_120m: "m/s",
      wind_direction_120m: "°",
      wind_speed_180m: "m/s",
      wind_direction_180m: "°",
      wind_speed_1000hPa: "m/s",
      wind_direction_1000hPa: "°",
      geopotential_height_1000hPa: "m",
      wind_speed_925hPa: "m/s",
      wind_direction_925hPa: "°",
      geopotential_height_925hPa: "m",
    },
    hourly: {
      time: ["2026-07-29T20:00"],
      wind_speed_10m: [2],
      wind_direction_10m: [350],
      wind_speed_80m: [3],
      wind_direction_80m: [10],
      wind_speed_120m: [4],
      wind_direction_120m: [20],
      wind_speed_180m: [5],
      wind_direction_180m: [30],
      wind_speed_1000hPa: [6],
      wind_direction_1000hPa: [40],
      geopotential_height_1000hPa: [28],
      wind_speed_925hPa: [8],
      wind_direction_925hPa: [60],
      geopotential_height_925hPa: [800],
    },
  };
}

test("construit une colonne hybride AGL/AMSL triée et dédupliquée", () => {
  const column = parseOpenMeteoWindColumn(fixture(), "arome_seamless", 30);
  const slice = column.slices[0];
  assert.deepEqual(
    slice.levels.slice(0, 5).map((level) => level.geopotentialHeightAmslM),
    [30, 40, 110, 150, 210],
  );
  assert.equal(slice.levels[0].sourceType, "surface");
  assert.equal(slice.levels[0].isApproximation, true);
  assert.ok(
    slice.rejectedLevels.some((level) =>
      level.reason.includes("sous le terrain"),
    ),
  );
});

test("interpole la basse couche par composantes sans passer par 180°", () => {
  const levels = parseOpenMeteoWindColumn(
    fixture(),
    "arome_seamless",
    30,
  ).slices[0].levels;
  const wind = interpolateWindAtAltitude(levels, 75).wind;
  assert.ok(wind.directionFromDeg < 20 || wind.directionFromDeg > 340);
});

test("refuse une altitude supérieure à la couverture réelle", () => {
  const levels = parseOpenMeteoWindColumn(
    fixture(),
    "arome_seamless",
    30,
  ).slices[0].levels;
  assert.throws(() => interpolateWindAtAltitude(levels, 3000), {
    code: "WEATHER_VERTICAL_COVERAGE_INSUFFICIENT",
  });
});

test("le registre mappe sept modèles distincts sans fallback", () => {
  assert.equal(WEATHER_MODEL_REGISTRY.length, 7);
  assert.equal(
    new Set(WEATHER_MODEL_REGISTRY.map((model) => model.providerModelId)).size,
    7,
  );
  assert.equal(
    WEATHER_MODEL_REGISTRY.find((model) => model.id === "arome-hd")?.supported,
    false,
  );
});

test("normalise les altitudes, retire les doublons et conserve la palette", () => {
  assert.deepEqual(normalizeAltitudeOptions([1000, "ground", 300, 300]), [
    "ground",
    300,
    1000,
  ]);
  assert.equal(ALTITUDE_COLORS["1000"], "#f97316");
});
