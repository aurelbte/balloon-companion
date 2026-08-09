import assert from "node:assert/strict";
import test from "node:test";
import { sortAscensionsNewestFirst } from "./ascensionMockData.ts";

const ascension = (id, dateIso, time) => ({
  id, dateIso, time, date: dateIso, departure: "A", arrival: "B",
  registration: "F-TEST", balloonModel: "Z105", balloonType: "Air chaud",
  function: "Pilote", flightType: "Jour", maximumAltitudeM: null,
  officialDurationMinutes: 60, observations: "",
});

test("trie le Carnet par date, heure puis id décroissants", () => {
  const sorted = sortAscensionsNewestFirst([
    ascension("A2", "2026-08-08", "07:00"),
    ascension("A1", "2026-08-09", "06:00"),
    ascension("A3", "2026-08-09", "08:00"),
    ascension("A5", "2026-08-09", "08:00"),
    ascension("A4", "2026-08-09", "07:00"),
  ]);
  assert.deepEqual(sorted.map(({ id }) => id), ["A5", "A3", "A4", "A1", "A2"]);
});
