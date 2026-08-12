import assert from "node:assert/strict";
import test from "node:test";
import { clearAviationWeatherCacheForTests, loadAviationWeather, normalizeAirportIcao } from "./aviation/aviationWeather.ts";

const response = (body, status = 200) => new Response(status === 204 ? null : body, { status });

test("normalise l'ICAO associé au favori sans inventer d'aérodrome", () => {
  assert.equal(normalizeAirportIcao(" lfqo "), "LFQO");
  assert.equal(normalizeAirportIcao("Lille"), null);
});

test("récupère et conserve intégralement METAR et TAF bruts", async () => {
  clearAviationWeatherCacheForTests();
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return String(url).includes("/metar?") ? response("LFQO 121200Z 24008KT CAVOK 20/10 Q1015") : response("TAF LFQO 121100Z 1212/1312 24008KT CAVOK"); };
  const result = await loadAviationWeather({ airport: "lfqo", fetchImpl, now: () => Date.parse("2026-08-12T12:05:00Z") });
  assert.equal(result.error, null);
  assert.equal(result.data.metarRaw, "LFQO 121200Z 24008KT CAVOK 20/10 Q1015");
  assert.equal(result.data.tafRaw, "TAF LFQO 121100Z 1212/1312 24008KT CAVOK");
  assert.equal(result.data.metarIssuedAt, "2026-08-12T12:00:00.000Z");
  assert.equal(result.data.tafIssuedAt, "2026-08-12T11:00:00.000Z");
  assert.equal(result.data.status, "AVAILABLE");
  assert.equal(calls.length, 2);
});

test("cache par aérodrome sans dépendre du modèle météo", async () => {
  clearAviationWeatherCacheForTests();
  let calls = 0;
  const fetchImpl = async (url) => { calls += 1; return String(url).includes("/metar?") ? response("EBKT 121200Z AUTO 24008KT CAVOK 20/10 Q1015") : response("", 204); };
  const first = await loadAviationWeather({ airport: "EBKT", fetchImpl, now: () => 1_000 });
  const second = await loadAviationWeather({ airport: "EBKT", fetchImpl, now: () => 2_000 });
  assert.strictEqual(first.data, second.data);
  assert.equal(first.data.status, "PARTIAL");
  assert.equal(calls, 2);
});

test("conserve la dernière donnée valide en cas d'échec ultérieur", async () => {
  clearAviationWeatherCacheForTests();
  const validFetch = async (url) => String(url).includes("/metar?") ? response("LFXX 121200Z 00000KT CAVOK 12/10 Q1010") : response("TAF LFXX 121100Z 1212/1312 CAVOK");
  await loadAviationWeather({ airport: "LFXX", fetchImpl: validFetch, now: () => 1_000 });
  const stale = await loadAviationWeather({ airport: "LFXX", fetchImpl: async () => { throw new Error("offline"); }, now: () => 700_000 });
  assert.equal(stale.data.status, "STALE");
  assert.ok(stale.data.metarRaw);
  assert.ok(stale.data.tafRaw);
});

test("retourne une erreur exploitable sans chaîne vide", async () => {
  clearAviationWeatherCacheForTests();
  const missingAirport = await loadAviationWeather({ airport: "" });
  assert.equal(missingAirport.error.code, "NO_AIRPORT");
  const missingData = await loadAviationWeather({ airport: "LFZZ", fetchImpl: async () => response("", 204), now: () => 1_000 });
  assert.equal(missingData.error.code, "NO_DATA");
  assert.ok(missingData.error.message.length > 0);
});
