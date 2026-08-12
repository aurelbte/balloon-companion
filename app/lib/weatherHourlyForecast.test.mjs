import assert from "node:assert/strict";
import test from "node:test";
import { clearHourlyForecastCacheForTests, normalizeWeatherCode, OpenMeteoHourlyForecastProvider, parseHourlyForecast } from "./weather/openMeteo/hourlyForecast.ts";

const payload = { latitude: 50.7, longitude: 3.1, hourly: { time: ["2026-08-12T06:00", "2026-08-12T09:00"], temperature_2m: [14, null], relative_humidity_2m: [81, 72], precipitation: [0.2, 0], weather_code: [2, 95], cloud_cover: [35, 80], visibility: [18000, 9000], wind_speed_10m: [8, 11], wind_direction_10m: [240, 260], wind_gusts_10m: [15, 22] } };

test("normalise les vrais créneaux et conserve unités, modèle et récupération", () => {
  const value = parseHourlyForecast(payload, "arome_seamless", "2026-08-12T04:01:00.000Z");
  assert.deepEqual(value.points.map(({ timestamp }) => timestamp), payload.hourly.time);
  assert.equal(value.points[0].temperatureC, 14);
  assert.equal(value.points[0].windSpeedKmh, 8);
  assert.equal(value.points[0].precipitationMm, 0.2);
  assert.equal(value.points[0].model, "arome_seamless");
  assert.equal(value.points[0].sourceUpdatedAt, "2026-08-12T04:01:00.000Z");
});

test("ne transforme jamais un champ absent en zéro", () => {
  const value = parseHourlyForecast(payload, "icon_seamless");
  assert.equal(value.points[1].temperatureC, undefined);
  assert.equal(value.points[1].precipitationMm, 0);
});

test("normalise les codes météo sans exposer d'icône", () => {
  assert.equal(normalizeWeatherCode(0), "CLEAR");
  assert.equal(normalizeWeatherCode(95), "THUNDERSTORM");
  assert.equal(normalizeWeatherCode(undefined), "UNKNOWN");
});

test("prend en charge exhaustivement la table WMO publiée par Open-Meteo", () => {
  const expected = {
    0: "CLEAR", 1: "MAINLY_CLEAR", 2: "PARTLY_CLOUDY", 3: "OVERCAST",
    45: "FOG", 48: "RIME_FOG",
    51: "LIGHT_DRIZZLE", 53: "MODERATE_DRIZZLE", 55: "DENSE_DRIZZLE",
    56: "LIGHT_FREEZING_DRIZZLE", 57: "DENSE_FREEZING_DRIZZLE",
    61: "LIGHT_RAIN", 63: "MODERATE_RAIN", 65: "HEAVY_RAIN",
    66: "LIGHT_FREEZING_RAIN", 67: "HEAVY_FREEZING_RAIN",
    71: "LIGHT_SNOW", 73: "MODERATE_SNOW", 75: "HEAVY_SNOW", 77: "SNOW_GRAINS",
    80: "LIGHT_RAIN_SHOWERS", 81: "MODERATE_RAIN_SHOWERS", 82: "VIOLENT_RAIN_SHOWERS",
    85: "LIGHT_SNOW_SHOWERS", 86: "HEAVY_SNOW_SHOWERS",
    95: "THUNDERSTORM", 96: "THUNDERSTORM_LIGHT_HAIL", 99: "THUNDERSTORM_HEAVY_HAIL",
  };
  for (const [code, normalized] of Object.entries(expected)) assert.equal(normalizeWeatherCode(Number(code)), normalized);
  for (const code of [4, 44, 50, 58, 64, 68, 76, 83, 87, 94, 97, 98, 100, -1]) assert.equal(normalizeWeatherCode(code), "UNKNOWN");
});

test("met en cache un jeu complet par lieu et modèle", async () => {
  clearHourlyForecastCacheForTests();
  let calls = 0;
  const client = { fetchHourlyForecast: async () => { calls += 1; return payload; }, fetchWindColumn: async () => ({}), fetchGroundTemperature: async () => ({}), fetchElevation: async () => ({}) };
  const provider = new OpenMeteoHourlyForecastProvider(client, () => 1_000);
  const query = { latitude: 50.7, longitude: 3.1, weatherModel: "gfs_seamless" };
  assert.strictEqual(await provider.getForecast(query), await provider.getForecast(query));
  assert.equal(calls, 1);
});
