import assert from "node:assert/strict";
import test from "node:test";
import { mergeAirspacesById } from "./airspaceMerge.ts";

function feature(id, name) {
  return {
    type: "Feature",
    id,
    geometry: { type: "Polygon", coordinates: [] },
    properties: { airspaceId: id, name },
  };
}

test("fusionne par airspaceId, conserve la version récente et un ordre stable", () => {
  const result = mergeAirspacesById([
    { tileId: "b", fetchedAt: 1, airspaces: [feature("z", "ancien"), feature("a", "A")] },
    { tileId: "a", fetchedAt: 2, airspaces: [feature("z", "récent")] },
  ]);
  assert.deepEqual(result.features.map((item) => item.properties.airspaceId), ["a", "z"]);
  assert.equal(result.features[1].properties.name, "récent");
});
