import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { clearAirportSearchCacheForTests, normalizeStations, searchAviationAirports, searchStations } from "./aviation/airportSearch.ts";

const payload = [
  { icaoId: "LFBO", site: "Toulouse-Blagnac", city: "Toulouse" },
  { icaoId: "LFQQ", site: "Lille-Lesquin", city: "Lille" },
  { icaoId: "LFQO", site: "Lille-Marcq-en-Barœul", city: "Bondues" },
];

test("normalise les métadonnées officielles AviationWeather.gov", () => {
  assert.deepEqual(normalizeStations(payload)[0], { icao: "LFBO", name: "Toulouse-Blagnac", locality: "Toulouse" });
});

test("recherche sans casse ni accents dans ICAO, nom et ville", () => {
  const stations = normalizeStations(payload);
  assert.deepEqual(searchStations(stations, "lfbo").map(({ icao }) => icao), ["LFBO"]);
  assert.deepEqual(searchStations(stations, "TOULOUSE").map(({ icao }) => icao), ["LFBO"]);
  assert.deepEqual(searchStations(stations, "lille").map(({ icao }) => icao), ["LFQQ", "LFQO"]);
  assert.deepEqual(searchStations(stations, "Lille").map(({ icao }) => icao), ["LFQQ", "LFQO"]);
  assert.deepEqual(searchStations(stations, "LF").map(({ icao }) => icao), ["LFQQ", "LFQO", "LFBO"]);
  assert.deepEqual(searchStations(stations, "LFQ").map(({ icao }) => icao), ["LFQQ", "LFQO"]);
  assert.equal(searchStations(stations, "LFQQ")[0]?.icao, "LFQQ");
});

test("décompresse le cache gzip officiel avant de rechercher Lille", async () => {
  clearAirportSearchCacheForTests();
  const compressed = gzipSync(JSON.stringify(payload));
  const results = await searchAviationAirports("Lille", async () => new Response(compressed), 1_000);
  assert.equal(results[0]?.icao, "LFQQ");
});

test("réutilise le cache officiel de stations entre recherches", async () => {
  clearAirportSearchCacheForTests();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify(payload)); };
  await searchAviationAirports("Toulouse", fetchImpl, 1_000);
  await searchAviationAirports("Lille", fetchImpl, 2_000);
  assert.equal(calls, 1);
});

test("le panneau temporise la recherche puis ajoute et sélectionne sans doublon", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(page, /window\.setTimeout\(.*350/);
  assert.match(page, /favorites\.filter\(\(\{ icao \}\) => icao !== favorite\.icao\)/);
  assert.match(page, /onChange\(\{ selected: favorite\.icao, favorites: next \}\)/);
  assert.match(page, /setAdding\(false\)/);
  assert.match(page, /Rechercher par nom ou code ICAO/);
  assert.match(page, /Aucun aérodrome trouvé/);
  assert.match(page, /className=\{styles\.airportSearchResult\}/);
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /if \(active\) setResults/);
  assert.match(page, /role="alert"/);
  assert.match(page, /result\.locality/);
  assert.match(page, /value=\{query\}/);
  assert.match(page, /loadAviationWeatherForAirport\(aviationAirport, controller\.signal\)/);
});
