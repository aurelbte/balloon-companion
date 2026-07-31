import test from "node:test";
import assert from "node:assert/strict";
import { getJournalFlight, JOURNAL_FLIGHTS } from "./journalMockData.ts";

test("le Journal V1 expose quatre vols déterministes aux traces complètes", () => {
  assert.equal(JOURNAL_FLIGHTS.length, 4);
  for (const flight of JOURNAL_FLIGHTS) {
    assert.ok(flight.points.length >= 2);
    assert.equal(flight.points[0]?.elapsedMinutes, 0);
    assert.equal(
      flight.points.at(-1)?.elapsedMinutes,
      flight.durationMinutes,
    );
    for (let index = 1; index < flight.points.length; index += 1) {
      assert.ok(
        flight.points[index].elapsedMinutes -
          flight.points[index - 1].elapsedMinutes <=
          2,
      );
    }
  }
});

test("la fiche LFQO vers Mérignies conserve les valeurs validées", () => {
  const flight = getJournalFlight("lfqo-merignies");
  assert.equal(flight?.durationMinutes, 52);
  assert.equal(flight?.distanceKm, 17.8);
  assert.equal(flight?.takeoffTime, "06:31");
  assert.equal(flight?.landingTime, "07:23");
  assert.equal(flight?.maxAltitudeM, 982);
  assert.equal(flight?.maxSpeedKmh, 28);
  assert.equal(flight?.statistics.averageAltitudeAmslM, 574);
  assert.equal(flight?.statistics.averageSpeedKmh, 20.5);
  assert.equal(flight?.statistics.maximumClimbRateMps, 3.1);
  assert.equal(flight?.statistics.maximumDescentRateMps, -2.4);
});

test("un identifiant inconnu ne produit aucune fausse fiche", () => {
  assert.equal(getJournalFlight("inconnu"), null);
});
