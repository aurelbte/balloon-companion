import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { searchAviationAirports, clearAirportSearchCacheForTests } from "./aviation/airportSearch.ts";
import { aviationWeatherCacheSizeForTests, clearAviationWeatherCacheForTests, loadAviationWeather } from "./aviation/aviationWeather.ts";
import { setBoundedTtlCacheEntry } from "./boundedTtlCache.ts";
import { parseNominatimResults } from "./geocodingSearch.ts";
import { validDurationMinutes } from "./preparationInputs.ts";
import { landingWeatherSamplePoints } from "./trajectoryArrivalSummary.ts";
import { validateMultiAltitudeProjectionRequest, validateTrajectoryProjectionRequest } from "./trajectory/integration.ts";
import { validateWindQuery } from "./trajectory/validation.ts";
import { createOpenMeteoClient } from "./weather/openMeteo/client.ts";
import { clearHourlyForecastCacheForTests, hourlyForecastCacheSizeForTests, OpenMeteoHourlyForecastProvider } from "./weather/openMeteo/hourlyForecast.ts";

const baseProjection = {
  launchSite: { name: "Bondues", latitude: 50.63, longitude: 3.06 },
  launchDateTimeIso: "2026-09-19T08:00:00Z",
  durationSeconds: 5_400,
  targetAltitudeAmslM: 300,
  weatherModel: "arome_seamless",
};

test("C14 borne les projections sans casser 90 ou 180 minutes ni les neuf altitudes", () => {
  assert.equal(validateTrajectoryProjectionRequest(baseProjection).durationSeconds, 5_400);
  assert.equal(validateTrajectoryProjectionRequest({ ...baseProjection, durationSeconds: 10_800 }).durationSeconds, 10_800);
  assert.throws(() => validateTrajectoryProjectionRequest({ ...baseProjection, durationSeconds: 10_801 }), /INVALID_DURATION/);
  assert.equal(validDurationMinutes("180"), true);
  assert.equal(validDurationMinutes("181"), false);

  const altitudes = ["ground", 100, 300, 600, 1000, 1500, 2000, 2500, 3000];
  assert.equal(validateMultiAltitudeProjectionRequest({ ...baseProjection, version: 2, altitudesAmslM: altitudes }).altitudesAmslM.length, 9);
  assert.throws(() => validateMultiAltitudeProjectionRequest({ ...baseProjection, version: 2, altitudesAmslM: [...altitudes, "ground"] }), /INVALID_ALTITUDES/);
  assert.throws(() => validateTrajectoryProjectionRequest({ ...baseProjection, launchSite: { ...baseProjection.launchSite, name: "x".repeat(201) } }), /INVALID_COORDINATES/);
});

function abortingFetch() {
  return async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
  });
}

test("C14 annule réellement Open-Meteo, Aviation et le dataset aérodromes", async () => {
  const client = createOpenMeteoClient({ tier: "free", fetchImpl: abortingFetch(), timeoutMs: 5 });
  await assert.rejects(client.fetchHourlyForecast({ latitude: 50, longitude: 3, weatherModel: "gfs_seamless" }), { code: "UPSTREAM_UNAVAILABLE" });

  clearAviationWeatherCacheForTests();
  const aviation = await loadAviationWeather({ airport: "LFQQ", fetchImpl: abortingFetch(), timeoutMs: 5, now: () => 1_000 });
  assert.equal(aviation.error.code, "SOURCE_UNAVAILABLE");

  clearAirportSearchCacheForTests();
  await assert.rejects(searchAviationAirports("Lille", abortingFetch(), 1_000, 5), { name: "AbortError" });
});

test("C14 refuse les coordonnées géocodées hors monde et borne le vent", () => {
  assert.deepEqual(parseNominatimResults([{ place_id: 1, display_name: "Invalide", lat: "91", lon: "3" }]), []);
  assert.equal(parseNominatimResults([{ place_id: 2, display_name: "Valide", lat: "90", lon: "180" }]).length, 1);
  assert.throws(() => validateWindQuery({ latitude: 50, longitude: 3, validAt: "2026-09-19T08:00:00Z", altitudeAmslM: 9_001, weatherModel: "gfs_seamless" }, ["gfs_seamless"]), { code: "INVALID_TARGET_ALTITUDE" });
  assert.equal(validateWindQuery({ latitude: 50, longitude: 3, validAt: "2026-09-19T08:00:00Z", altitudeAmslM: 9_000, weatherModel: "gfs_seamless" }, ["gfs_seamless"]).altitudeAmslM, 9_000);
});

test("C14 conserve neuf points landing et normalise autour de l'antiméridien", () => {
  const east = landingWeatherSamplePoints(0, 179.999);
  const west = landingWeatherSamplePoints(0, -179.999);
  assert.equal(east.length, 9);
  assert.equal(west.length, 9);
  for (const point of [...east, ...west]) assert.ok(point.longitude >= -180 && point.longitude <= 180);
});

test("C14 purge puis évince les caches bornés et réutilise une entrée fraîche", () => {
  for (const maximumEntries of [64, 256]) {
    const cache = new Map();
    setBoundedTtlCacheEntry(cache, "expired", { expiresAt: 9, value: 0 }, 0, maximumEntries);
    for (let index = 0; index < maximumEntries; index += 1) {
      setBoundedTtlCacheEntry(cache, `key-${index}`, { expiresAt: 100, value: index }, 10, maximumEntries);
    }
    assert.equal(cache.has("expired"), false);
    assert.equal(cache.size, maximumEntries);
    const fresh = cache.get("key-1");
    assert.strictEqual(cache.get("key-1"), fresh);
    setBoundedTtlCacheEntry(cache, "new", { expiresAt: 100, value: 999 }, 10, maximumEntries);
    assert.equal(cache.size, maximumEntries);
    assert.equal(cache.has("new"), true);
  }

  for (const path of ["weather/openMeteo/hourlyForecast.ts", "../api/weather/landing-zone/route.ts", "aviation/aviationWeather.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /setBoundedTtlCacheEntry/);
  }
});

test("C14 borne réellement les caches hourly et Aviation à 256 entrées", async () => {
  clearHourlyForecastCacheForTests();
  const hourlyPayload = { latitude: 50, longitude: 3, hourly: { time: [] } };
  const provider = new OpenMeteoHourlyForecastProvider({
    fetchHourlyForecast: async () => hourlyPayload,
    fetchHourlyForecastBatch: async () => [],
    fetchWindColumn: async () => ({}),
    fetchGroundTemperature: async () => ({}),
    fetchElevation: async () => ({}),
    fetchElevationBatch: async () => ({}),
  }, () => 1_000);
  for (let index = 0; index < 257; index += 1) {
    await provider.getForecast({ latitude: index / 1_000, longitude: 3, weatherModel: "gfs_seamless" });
  }
  assert.equal(hourlyForecastCacheSizeForTests(), 256);

  clearAviationWeatherCacheForTests();
  const fetchImpl = async (url) => String(url).includes("/metar?")
    ? new Response("TEST 191200Z 00000KT CAVOK 12/10 Q1015")
    : new Response(null, { status: 204 });
  for (let index = 0; index < 257; index += 1) {
    const airport = index.toString(36).toUpperCase().padStart(4, "A");
    await loadAviationWeather({ airport, fetchImpl, now: () => 1_000 });
  }
  assert.equal(aviationWeatherCacheSizeForTests(), 256);
});

test("C14 fixe les timeouts et longueurs des routes concernées", () => {
  const sources = {
    openAip: readFileSync(new URL("../api/openaip/airspaces/route.ts", import.meta.url), "utf8"),
    geocoding: readFileSync(new URL("../api/geocoding/search/route.ts", import.meta.url), "utf8"),
    airports: readFileSync(new URL("../api/aviation/airports/search/route.ts", import.meta.url), "utf8"),
    hourly: readFileSync(new URL("../api/weather/hourly/route.ts", import.meta.url), "utf8"),
    landing: readFileSync(new URL("../api/weather/landing-zone/route.ts", import.meta.url), "utf8"),
    powerLines: readFileSync(new URL("../api/osm/power-lines/route.ts", import.meta.url), "utf8"),
  };
  assert.match(sources.openAip, /12_000/);
  assert.match(sources.openAip, /dist > 100_000/);
  assert.match(sources.openAip, /page > 100/);
  assert.match(sources.geocoding, /8_000/);
  assert.match(sources.geocoding, /query\.length > 120/);
  assert.match(sources.airports, /query\.length > 120/);
  assert.match(sources.hourly, /isValidCoordinate/);
  assert.match(sources.landing, /isValidCoordinate/);
  assert.match(sources.powerLines, /bounds\.west < -180/);
  assert.match(sources.powerLines, /bounds\.north > 90/);
});
