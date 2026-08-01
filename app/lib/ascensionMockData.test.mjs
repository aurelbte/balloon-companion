import test from "node:test";
import assert from "node:assert/strict";
import {
  ASCENSION_OPENING_BALANCE,
  formatOfficialDuration,
  getAscension,
} from "./ascensionMockData.ts";

test("le solde initial conserve l’expérience acquise avant Balloon Companion", () => {
  assert.equal(ASCENSION_OPENING_BALANCE.ascensions, 108);
  assert.equal(formatOfficialDuration(ASCENSION_OPENING_BALANCE.officialDurationMinutes), "136 h 35");
});

test("une ascension conserve ses données officielles déterministes", () => {
  const ascension = getAscension("2026-07-29-lfqo-merignies");
  assert.equal(ascension?.registration, "F-HLFM");
  assert.equal(ascension?.balloonModel, "Cameron Z105");
  assert.equal(ascension?.maximumAltitudeM, 982);
  assert.equal(ascension?.officialDurationMinutes, 60);
});
