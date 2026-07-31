import test from "node:test";
import assert from "node:assert/strict";
import { selectIntersectedAirspaces } from "./trajectoryAirspaces.ts";

function properties(id, name = id) {
  return {
    id,
    airspaceId: id,
    airspaceCompositeKey: `${name}|4||`,
    name,
    type: 4,
    typeLabel: "CTR",
    icaoClass: 3,
    icaoClassLabel: "D",
    lowerLimit: null,
    upperLimit: null,
    lowerLimitMin: null,
    upperLimitMax: null,
    frequencies: [],
    remarks: null,
    country: "FR",
    activity: null,
    onDemand: null,
    onRequest: null,
    byNotam: null,
    activeFrom: null,
    activeUntil: null,
  };
}

function feature(id, coordinates, type = "Polygon") {
  return {
    type: "Feature",
    id,
    properties: properties(id),
    geometry: { type, coordinates },
  };
}

function trace(id, coordinates) {
  return {
    traceId: id,
    projection: {
      points: coordinates.map(([longitude, latitude], index) => ({
        longitude,
        latitude,
        elapsedSeconds: index * 20,
      })),
    },
  };
}

const square = [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]];

test("sélectionne uniquement les espaces traversés par une trajectoire", () => {
  const result = selectIntersectedAirspaces(
    [trace("a", [[0, 2], [4, 2]])],
    {
      type: "FeatureCollection",
      features: [
        feature("crossed", square),
        feature("outside", [[[6, 6], [7, 6], [7, 7], [6, 7], [6, 6]]]),
      ],
    },
  );
  assert.deepEqual(result.map((item) => item.airspaceId), ["crossed"]);
});

test("déduplique un même espace traversé par plusieurs trajectoires", () => {
  const result = selectIntersectedAirspaces(
    [trace("a", [[0, 2], [4, 2]]), trace("b", [[2, 0], [2, 4]])],
    {
      type: "FeatureCollection",
      features: [feature("shared", square)],
    },
  );
  assert.equal(result.length, 1);
});

test("détecte une trajectoire entièrement contenue et un MultiPolygon", () => {
  const result = selectIntersectedAirspaces(
    [trace("a", [[1.5, 1.5], [2.5, 2.5]])],
    {
      type: "FeatureCollection",
      features: [feature("multi", [square, [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]]], "MultiPolygon")],
    },
  );
  assert.equal(result[0]?.airspaceId, "multi");
});

test("retourne une liste vide sans trajectoire", () => {
  assert.deepEqual(
    selectIntersectedAirspaces([], {
      type: "FeatureCollection",
      features: [feature("airspace", square)],
    }),
    [],
  );
});
