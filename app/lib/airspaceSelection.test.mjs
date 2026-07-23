import assert from "node:assert/strict";
import test from "node:test";
import {
  createAirspaceSelectionIndex,
  resolveRenderedAirspaces,
} from "./airspaceSelection.ts";
import { createAirspaceCompositeKey } from "./openaip.ts";

const lowerLimit = { value: 0, unit: 1, referenceDatum: 0 };
const upperLimit = { value: 2500, unit: 1, referenceDatum: 1 };

function airspace(id, name = `Zone ${id}`, type = 7) {
  const properties = {
    id: String(id),
    airspaceId: String(id),
    name,
    type,
    lowerLimit,
    upperLimit,
  };

  return {
    ...properties,
    airspaceCompositeKey: createAirspaceCompositeKey(properties),
  };
}

function collection(...properties) {
  return {
    type: "FeatureCollection",
    features: properties.map((item) => ({
      type: "Feature",
      id: item.airspaceId,
      properties: item,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [3, 50],
            [4, 50],
            [4, 51],
            [3, 50],
          ],
        ],
      },
    })),
  };
}

test("résout un espace via properties.airspaceId", () => {
  const item = airspace("alpha");
  const index = createAirspaceSelectionIndex(collection(item));

  assert.deepEqual(
    resolveRenderedAirspaces([{ properties: { airspaceId: "alpha" } }], index),
    [item],
  );
});

test("utilise feature.id lorsque airspaceId est absent", () => {
  const item = airspace("alpha");
  const index = createAirspaceSelectionIndex(collection(item));

  assert.deepEqual(resolveRenderedAirspaces([{ id: "alpha" }], index), [item]);
});

test("normalise les identifiants numériques et textuels", () => {
  const item = airspace(123);
  const index = createAirspaceSelectionIndex(collection(item));

  assert.deepEqual(
    resolveRenderedAirspaces([{ properties: { airspaceId: 123 } }], index),
    [item],
  );
});

test("déduplique les résultats provenant du remplissage et du contour", () => {
  const item = airspace("alpha");
  const index = createAirspaceSelectionIndex(collection(item));

  assert.deepEqual(
    resolveRenderedAirspaces(
      [
        { properties: { airspaceId: "alpha" } },
        { id: "alpha" },
      ],
      index,
    ),
    [item],
  );
});

test("conserve plusieurs espaces superposés", () => {
  const first = airspace("alpha");
  const second = airspace("bravo");
  const index = createAirspaceSelectionIndex(collection(first, second));

  assert.deepEqual(
    resolveRenderedAirspaces(
      [
        { properties: { airspaceId: "alpha" } },
        { properties: { airspaceId: "bravo" } },
      ],
      index,
    ),
    [first, second],
  );
});

test("ignore un identifiant inconnu", () => {
  const index = createAirspaceSelectionIndex(collection(airspace("alpha")));

  assert.deepEqual(
    resolveRenderedAirspaces(
      [{ properties: { airspaceId: "unknown" } }],
      index,
    ),
    [],
  );
});

test("ignore une feature sans identifiant ni clé composite exploitable", () => {
  const index = createAirspaceSelectionIndex(collection(airspace("alpha")));

  assert.deepEqual(resolveRenderedAirspaces([{ properties: {} }], index), []);
});

test("utilise la clé composite contrôlée en dernier recours", () => {
  const item = airspace("alpha", "TMA Lille", 7);
  const index = createAirspaceSelectionIndex(collection(item));

  assert.deepEqual(
    resolveRenderedAirspaces(
      [
        {
          properties: {
            name: item.name,
            type: String(item.type),
            lowerLimit: JSON.stringify(item.lowerLimit),
            upperLimit: JSON.stringify(item.upperLimit),
          },
        },
      ],
      index,
    ),
    [item],
  );
});
