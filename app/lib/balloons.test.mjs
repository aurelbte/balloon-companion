import test from "node:test";
import assert from "node:assert/strict";
import { balloonDisplayName, createBalloon, officialFieldsForBalloon, REGISTERED_BALLOONS } from "./balloons.ts";

test("les ballons enregistrés partagent un format opérationnel unique", () => {
  assert.equal(REGISTERED_BALLOONS.length, 4);
  assert.equal(balloonDisplayName(REGISTERED_BALLOONS[0]), "F-HLFM • Cameron Z105");
});

test("la sélection d’un ballon remplit les deux champs officiels", () => {
  assert.deepEqual(officialFieldsForBalloon(REGISTERED_BALLOONS[1]), {
    registration: "F-HOBA",
    balloonModel: "Cameron Z350",
  });
});

test("un nouveau ballon normalise son immatriculation sans inventer les champs facultatifs", () => {
  const balloon = createBalloon({ registration: " f-abcd ", manufacturer: " Cameron ", model: " Z90 ", volumeM3: 2_550 });
  assert.equal(balloon.id, "F-ABCD");
  assert.equal(balloon.registration, "F-ABCD");
  assert.equal(balloon.manufacturer, "Cameron");
  assert.equal(balloon.model, "Z90");
  assert.equal(balloon.color, undefined);
});
