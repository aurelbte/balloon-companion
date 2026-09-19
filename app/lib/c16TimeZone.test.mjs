import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { combineLocalDateAndTime } from "./trajectory/integration.ts";
import { civilDateTimeToIso, formatInTimeZone, zonedDateTimeParts } from "./timeZone.ts";
import { migrateStoredPreparation } from "./flightStorage.ts";
import { createRecordedFlight } from "./recordedFlight.ts";
import { recordedFlightToJournalFlight } from "./realFlightJournal.ts";

test("une heure civile est convertie dans le fuseau du terrain", () => {
  assert.equal(combineLocalDateAndTime("2026-07-01", "08:00", "America/Toronto"), "2026-07-01T12:00:00.000Z");
  assert.equal(combineLocalDateAndTime("2026-07-02", "01:00", "Asia/Tokyo"), "2026-07-01T16:00:00.000Z");
  assert.deepEqual(zonedDateTimeParts("2026-07-01T16:00:00Z", "Asia/Tokyo"), { date: "2026-07-02", time: "01:00" });
});

test("les heures DST inexistantes ou ambiguës ne sont jamais inventées", () => {
  assert.equal(civilDateTimeToIso("2026-03-08", "02:30", "America/Toronto"), null);
  assert.equal(civilDateTimeToIso("2026-11-01", "01:30", "America/Toronto"), null);
  assert.equal(civilDateTimeToIso("2026-11-01", "03:30", "America/Toronto"), "2026-11-01T08:30:00.000Z");
});

test("les anciennes préparations sans fuseau restent lisibles", () => {
  const old = migrateStoredPreparation({ storageVersion: 3, launchSite: null, departureTime: "2026-07-01T06:00:00Z", durationMinutes: 60, weatherModel: "arome_seamless", targetAltitudeAmslM: 300, createdAt: 1, updatedAt: 1 });
  assert.equal(old?.departureTime, "2026-07-01T06:00:00Z");
  assert.equal(old?.launchTimeZone, undefined);
  assert.ok(combineLocalDateAndTime("2026-07-01", "08:00"));
});

test("un nouveau vol conserve le fuseau du snapshot et le journal l'utilise", () => {
  const weatherSnapshot = { version: 1, weatherModel: "arome_seamless", modelLabel: "AROME", referenceLocation: { name: "Montréal", latitude: 45.5, longitude: -73.5, terrainAltitudeAmslM: 30 }, forecastAtIso: "2026-07-01T12:00:00Z", launchTimeZone: "America/Toronto", sourceUpdatedAt: "2026-07-01T11:00:00Z", windProfile: [] };
  const flight = createRecordedFlight({ startedAt: Date.parse("2026-07-01T12:00:00Z"), weatherSnapshot });
  assert.equal(flight.timeZone, "America/Toronto");
  const journal = recordedFlightToJournalFlight(flight);
  assert.equal(journal.takeoffTime, "08:00");
  assert.equal(journal.dateIso, "2026-07-01");
  assert.equal(journal.timeZone, "America/Toronto");
  const legacy = recordedFlightToJournalFlight({ ...flight, timeZone: undefined, weatherSnapshot: undefined });
  assert.equal(typeof legacy.takeoffTime, "string");
});

test("un nouveau vol conserve le fuseau de préparation sans snapshot", () => {
  const startedAt = Date.parse("2026-07-01T12:00:00Z");
  const flight = createRecordedFlight({ startedAt, timeZone: "America/Toronto" });
  assert.equal(flight.startedAt, startedAt);
  assert.equal(flight.timeZone, "America/Toronto");
  const journal = recordedFlightToJournalFlight(flight);
  assert.equal(journal.takeoffTime, "08:00");
  assert.equal(journal.timeZone, "America/Toronto");
});

test("le snapshot reste prioritaire et l'absence de fuseau conserve le fallback historique", () => {
  const weatherSnapshot = { version: 1, weatherModel: "arome_seamless", modelLabel: "AROME", referenceLocation: { name: "Montréal", latitude: 45.5, longitude: -73.5, terrainAltitudeAmslM: 30 }, forecastAtIso: "2026-07-01T12:00:00Z", launchTimeZone: "America/Toronto", sourceUpdatedAt: "2026-07-01T11:00:00Z", windProfile: [] };
  const withBoth = createRecordedFlight({ startedAt: 1_000, timeZone: "Europe/Paris", weatherSnapshot });
  assert.equal(withBoth.timeZone, "America/Toronto");
  assert.equal(withBoth.startedAt, 1_000);
  const withoutEither = createRecordedFlight({ startedAt: 2_000 });
  assert.equal(withoutEither.timeZone, undefined);
  assert.equal(withoutEither.startedAt, 2_000);
});

test("les écrans propagent le fuseau sans modifier la sélection C6", () => {
  const prepare = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
  const briefing = readFileSync(new URL("../briefing/page.tsx", import.meta.url), "utf8");
  const weather = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  const current = readFileSync(new URL("./weather/currentWeather.ts", import.meta.url), "utf8");
  const ground = readFileSync(new URL("../api/weather/ground-temperature/route.ts", import.meta.url), "utf8");
  const flight = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const tracking = readFileSync(new URL("../hooks/useFlightTracking.ts", import.meta.url), "utf8");
  assert.match(prepare, /loadHourlyWeatherForecast/);
  assert.match(prepare, /calculateSunTimes[\s\S]*form\.launchTimeZone/);
  assert.match(briefing, /formatInTimeZone\(preparation\.departureTime, preparation\.launchTimeZone/);
  assert.match(weather, /zonedDateTimeParts\(now, forecastTimeZone\)/);
  assert.match(current, /const HALF_HOUR = 30 \* 60_000/);
  assert.match(ground, /timeZone = requestedTimeZone[\s\S]*: "UTC"/);
  assert.doesNotMatch(ground, /Europe\/Paris/);
  assert.match(flight, /preparation\?\.launchTimeZone[\s\S]*timeZone: preparation\.launchTimeZone/);
  assert.match(tracking, /timeZone: context\.timeZone/);
});

test("le formatage explicite du lieu ne dépend pas du fuseau du téléphone", () => {
  assert.match(formatInTimeZone("2026-07-01T12:00:00Z", "America/Toronto", { hour: "2-digit", minute: "2-digit" }), /08:00/);
});
