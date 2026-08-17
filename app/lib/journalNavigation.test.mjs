import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compareJournalFlightsMostRecentFirst, journalFlightStartTimestamp } from "./realFlightJournal.ts";

function flight(id, dateIso, takeoffTime, startedAt) {
  return { id, dateIso, takeoffTime, startedAt, origin: "MANUAL", departure: "A", arrival: "B", date: dateIso, balloonRegistration: "F-TEST", durationMinutes: 60, distanceKm: 10, landingTime: "00:00", maxAltitudeM: null, maxSpeedKmh: null, notes: null, statistics: {}, points: [] };
}

test("le tri récent tient compte de l'heure réelle pour deux vols du même jour", () => {
  const morning = flight("morning", "2026-08-16", "07:27");
  const evening = flight("evening", "2026-08-16", "19:48");
  assert.deepEqual([morning, evening].sort(compareJournalFlightsMostRecentFirst).map(({ id }) => id), ["evening", "morning"]);
});

test("startedAt est prioritaire et le fallback date/heure reste compatible avec les anciens vols manuels", () => {
  const real = flight("real", "2020-01-01", "00:00", Date.UTC(2026, 7, 17, 6));
  const legacyManual = flight("manual", "2026-08-16", "19:48");
  assert.equal(journalFlightStartTimestamp(real), Date.UTC(2026, 7, 17, 6));
  assert.ok(journalFlightStartTimestamp(real) > journalFlightStartTimestamp(legacyManual));
});

test("le tri est déterministe entre vols de même date et même heure", () => {
  const flights = [flight("z", "2026-08-16", "07:27"), flight("a", "2026-08-16", "07:27")];
  assert.deepEqual(flights.sort(compareJournalFlightsMostRecentFirst).map(({ id }) => id), ["a", "z"]);
});

test("seule la fiche force le haut au changement de vol", () => {
  const detail = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");
  const list = readFileSync(new URL("../components/journal/JournalFlightList.tsx", import.meta.url), "utf8");
  assert.match(detail, /useLayoutEffect\(\(\) => \{\s*window\.scrollTo\(0, 0\);\s*\}, \[flightId\]\)/);
  assert.doesNotMatch(list, /scrollTo\(/);
});
