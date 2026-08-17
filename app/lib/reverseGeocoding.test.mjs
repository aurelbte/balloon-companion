import assert from "node:assert/strict";
import test from "node:test";
import { nominatimItemToFlightPlace } from "./reverseGeocoding.ts";
import { selectFlightPlaceName } from "./journalFlightTitle.ts";

test("un aérodrome contenant réellement le point expose son ICAO", () => {
  const place = nominatimItemToFlightPlace({
    category: "aeroway",
    type: "aerodrome",
    name: "Lille Marcq-en-Barœul",
    boundingbox: ["50.67", "50.70", "3.05", "3.10"],
    extratags: { icao: "LFQO" },
    address: { city: "Bondues" },
  }, { latitude: 50.686341, longitude: 3.079865 });
  assert.equal(place.identifiedAerodrome, true);
  assert.equal(selectFlightPlaceName(place, "Départ inconnu"), "LFQO");
});

test("un aérodrome seulement proche ne permet jamais d'inventer un ICAO", () => {
  const place = nominatimItemToFlightPlace({
    category: "aeroway",
    type: "aerodrome",
    boundingbox: ["50.67", "50.70", "3.05", "3.10"],
    extratags: { icao: "LFQO" },
    address: { village: "Mérignies" },
  }, { latitude: 50.57, longitude: 3.32 });
  assert.equal(place.identifiedAerodrome, false);
  assert.equal(selectFlightPlaceName(place, "Arrivée inconnue"), "Mérignies");
});
