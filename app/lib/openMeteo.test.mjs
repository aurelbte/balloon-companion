import test from "node:test";
import assert from "node:assert/strict";
import { OpenMeteoWindProvider } from "./weather/openMeteo/adapter.ts";
import {
  parseOpenMeteoElevation,
  parseOpenMeteoWindColumn,
} from "./weather/openMeteo/parser.ts";

function windFixture() {
  return {
    latitude: 50.63,
    longitude: 3.06,
    elevation: 25,
    hourly_units: {
      time: "iso8601",
      wind_speed_10m: "m/s",
      wind_direction_10m: "°",
      wind_speed_1000hPa: "m/s",
      wind_direction_1000hPa: "°",
      geopotential_height_1000hPa: "m",
      wind_speed_975hPa: "m/s",
      wind_direction_975hPa: "°",
      geopotential_height_975hPa: "m",
      wind_speed_950hPa: "m/s",
      wind_direction_950hPa: "°",
      geopotential_height_950hPa: "m",
    },
    hourly: {
      time: ["2026-07-27T04:00", "2026-07-27T05:00"],
      wind_speed_10m: [2, 4],
      wind_direction_10m: [270, 270],
      wind_speed_1000hPa: [4, 6],
      wind_direction_1000hPa: [270, 270],
      geopotential_height_1000hPa: [100, 120],
      wind_speed_975hPa: [null, null],
      wind_direction_975hPa: [null, null],
      geopotential_height_975hPa: [null, null],
      wind_speed_950hPa: [8, 10],
      wind_direction_950hPa: [270, 270],
      geopotential_height_950hPa: [500, 520],
    },
  };
}

test("ignore proprement un niveau Open-Meteo absent", () => {
  const column = parseOpenMeteoWindColumn(
    windFixture(),
    "arome_seamless",
  );
  assert.equal(
    column.slices[0].levels.some((level) => level.pressureHpa === 975),
    false,
  );
  assert.equal(
    column.slices[0].levels.some((level) => level.pressureHpa === 1000),
    true,
  );
});

test("l’adaptateur Open-Meteo respecte WindProvider et trace les interpolations", async () => {
  let calls = 0;
  const client = {
    async fetchWindColumn() {
      calls += 1;
      return windFixture();
    },
    async fetchElevation() {
      throw new Error("non utilisé");
    },
  };
  const provider = new OpenMeteoWindProvider(client);
  const sample = await provider.getWind({
    latitude: 50.631,
    longitude: 3.058,
    validAt: "2026-07-27T04:30:00Z",
    altitudeAmslM: 300,
    weatherModel: "arome_seamless",
  });

  assert.equal(calls, 1);
  assert.equal(sample.sourceModel, "arome_seamless");
  assert.equal(sample.sourceSlices.length, 2);
  assert.equal(sample.temporalInterpolation?.ratio, 0.5);
  assert.equal(sample.sourceSlices[0].lowerLevel.pressureHpa, 1000);
  assert.equal(sample.sourceSlices[0].upperLevel.pressureHpa, 950);
  assert.ok(sample.warnings.some((warning) => warning.includes("verticalement")));
  assert.ok(sample.warnings.some((warning) => warning.includes("temporellement")));
});

test("une session de projection Open-Meteo ne charge la colonne qu’une fois", async () => {
  let calls = 0;
  const provider = new OpenMeteoWindProvider({
    async fetchWindColumn() {
      calls += 1;
      return windFixture();
    },
    async fetchElevation() {
      throw new Error("non utilisé");
    },
  });
  const baseQuery = {
    latitude: 50.631,
    longitude: 3.058,
    validAt: "2026-07-27T04:00:00Z",
    altitudeAmslM: 300,
    weatherModel: "arome_seamless",
  };
  const session = await provider.prepareProjection(baseQuery);
  await session.getWind(baseQuery);
  await session.getWind({
    ...baseQuery,
    validAt: "2026-07-27T04:30:00Z",
  });
  assert.equal(calls, 1);
});

test("un vent absent produit une erreur structurée", async () => {
  const fixture = windFixture();
  for (const key of Object.keys(fixture.hourly)) {
    if (key !== "time") fixture.hourly[key] = [null, null];
  }
  delete fixture.elevation;

  const provider = new OpenMeteoWindProvider({
    async fetchWindColumn() {
      return fixture;
    },
    async fetchElevation() {
      return {};
    },
  });

  await assert.rejects(
    provider.getWind({
      latitude: 50.631,
      longitude: 3.058,
      validAt: "2026-07-27T04:30:00Z",
      altitudeAmslM: 300,
      weatherModel: "arome_seamless",
    }),
    { code: "MISSING_WIND_DATA" },
  );
});

test("une élévation absente ne devient jamais 0", () => {
  assert.throws(
    () => parseOpenMeteoElevation({ elevation: [] }),
    { code: "ELEVATION_UNAVAILABLE" },
  );
  assert.equal(parseOpenMeteoElevation({ elevation: [0] }), 0);
});
