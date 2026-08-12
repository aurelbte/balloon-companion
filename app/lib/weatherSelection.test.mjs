import assert from "node:assert/strict";
import test from "node:test";
import { availableDays, availableTimes, closestAvailableDay, closestAvailableTime, relativeUpdateLabel } from "./weather/weatherSelection.ts";

const point = (timestamp) => ({ timestamp, weatherCode: "CLEAR", model: "arome_seamless", sourceUpdatedAt: "2026-08-12T10:00:00Z" });
const points = [point("2026-08-12T06:00"), point("2026-08-12T09:00"), point("2026-08-13T07:00"), point("2026-08-13T10:00")];

test("expose uniquement les jours et heures réellement reçus", () => {
  assert.deepEqual(availableDays(points), ["2026-08-12", "2026-08-13"]);
  assert.deepEqual(availableTimes(points, "2026-08-13"), ["07:00", "10:00"]);
});

test("conserve l'heure disponible ou choisit la plus proche", () => {
  assert.equal(closestAvailableTime(["07:00", "10:00"], "10:00"), "10:00");
  assert.equal(closestAvailableTime(["07:00", "10:00"], "09:00"), "10:00");
});

test("sélectionne automatiquement le jour réel le plus proche", () => {
  assert.equal(closestAvailableDay(["2026-08-12", "2026-08-14"], "2026-08-13"), "2026-08-12");
});

test("formate l'âge depuis le vrai timestamp", () => {
  const now = Date.parse("2026-08-12T12:00:00Z");
  assert.equal(relativeUpdateLabel("2026-08-12T12:00:00Z", now), "Il y a 0 min");
  assert.equal(relativeUpdateLabel("2026-08-12T11:59:00Z", now), "Il y a 1 min");
  assert.match(relativeUpdateLabel("2026-08-12T10:00:00Z", now), /^Actualisé à \d{2}:\d{2}$/);
});
