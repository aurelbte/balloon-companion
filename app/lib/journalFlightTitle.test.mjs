import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeneratedFlightTitle,
  formatJournalTakeoffTime,
  getJournalFlightDisplayTitle,
  selectFlightPlaceName,
  withoutCustomFlightTitle,
} from "./journalFlightTitle.ts";

const flight = {
  id: "flight-1", departure: "LFQQ", arrival: "Mérignies", takeoffTime: "06:45",
  date: "4 août 2026", dateIso: "2026-08-04", balloonRegistration: "F-HLFM",
  durationMinutes: 52, distanceKm: 17.8, landingTime: "07:37", maxAltitudeM: 900,
  maxSpeedKmh: 25, notes: null, statistics: {}, points: [],
};

test("la priorité de lieu n'utilise l'ICAO que pour un aérodrome explicitement identifié", () => {
  assert.equal(selectFlightPlaceName({ icaoCode: "lfqo", municipality: "Bondues", identifiedAerodrome: true }, "Départ inconnu"), "LFQO");
  assert.equal(selectFlightPlaceName({ icaoCode: "LFQO", municipality: "Bondues" }, "Départ inconnu"), "Bondues");
  assert.equal(selectFlightPlaceName({ aerodromeName: "Aérodrome de Lille", identifiedAerodrome: true }, "Départ inconnu"), "Aérodrome de Lille");
  assert.equal(selectFlightPlaceName({ preparedSiteName: "Terrain club" }, "Départ inconnu"), "Terrain club");
  assert.equal(selectFlightPlaceName({}, "Arrivée inconnue"), "Arrivée inconnue");
});

test("le titre factuel conserve route et heure sans donnée ballon", () => {
  assert.equal(buildGeneratedFlightTitle(flight), "LFQQ → Mérignies · 06:45");
  assert.equal(buildGeneratedFlightTitle({ ...flight, takeoffTime: "19:33" }), "LFQQ → Mérignies · 19:33");
  assert.equal(buildGeneratedFlightTitle({ ...flight, balloonRegistration: "F-XXXX" }), buildGeneratedFlightTitle(flight));
});

test("l'heure est issue du timestamp et le fuseau est maîtrisé", () => {
  const startedAt = Date.parse("2026-08-04T04:45:00.000Z");
  assert.equal(formatJournalTakeoffTime(startedAt, "Europe/Paris"), "06:45");
  assert.equal(formatJournalTakeoffTime(startedAt, "UTC"), "04:45");
});

test("le titre personnalisé est prioritaire et peut être rétabli", () => {
  const customized = { ...flight, generatedTitle: buildGeneratedFlightTitle(flight), customTitle: "Vol du matin avec élève" };
  assert.equal(getJournalFlightDisplayTitle(customized), "Vol du matin avec élève");
  assert.equal(getJournalFlightDisplayTitle(withoutCustomFlightTitle(customized)), "LFQQ → Mérignies · 06:45");
});
