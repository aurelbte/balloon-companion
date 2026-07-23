import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlightContext,
  findContainingAirspaces,
  getAirspaceDisplayPriority,
  isPositionInsideAirspaceGeometry,
} from "./flightContext.ts";
import { selectAirspaceForMapClick } from "./airspaceMapSelection.ts";

const square = {
  type: "Polygon",
  coordinates: [
    [
      [2, 49],
      [4, 49],
      [4, 51],
      [2, 51],
      [2, 49],
    ],
  ],
};

function properties({
  id,
  name = id,
  type = 0,
  lowerLimit = { value: 0, unit: 1, referenceDatum: 0 },
  upperLimit = { value: 5000, unit: 1, referenceDatum: 1 },
  frequencies = [],
}) {
  return {
    id,
    airspaceId: id,
    airspaceCompositeKey: `${name}|${type}`,
    name,
    type,
    typeLabel: "Test",
    icaoClass: 3,
    icaoClassLabel: "D",
    lowerLimit,
    upperLimit,
    lowerLimitMin: null,
    upperLimitMax: null,
    frequencies,
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

function feature(props, geometry = square) {
  return {
    type: "Feature",
    id: props.airspaceId,
    properties: props,
    geometry,
  };
}

function collection(...features) {
  return { type: "FeatureCollection", features };
}

const position = { latitude: 50, longitude: 3 };

test("détecte une position dans un Polygon", () => {
  assert.equal(isPositionInsideAirspaceGeometry(position, square), true);
});

test("rejette une position hors d’un Polygon", () => {
  assert.equal(
    isPositionInsideAirspaceGeometry(
      { latitude: 52, longitude: 3 },
      square,
    ),
    false,
  );
});

test("détecte une position dans un MultiPolygon", () => {
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      square.coordinates,
      [
        [
          [9, 49],
          [11, 49],
          [11, 51],
          [9, 51],
          [9, 49],
        ],
      ],
    ],
  };
  assert.equal(isPositionInsideAirspaceGeometry(position, geometry), true);
});

test("exclut une position située dans un trou", () => {
  const geometry = {
    type: "Polygon",
    coordinates: [
      square.coordinates[0],
      [
        [2.5, 49.5],
        [3.5, 49.5],
        [3.5, 50.5],
        [2.5, 50.5],
        [2.5, 49.5],
      ],
    ],
  };
  assert.equal(isPositionInsideAirspaceGeometry(position, geometry), false);
});

test("conserve deux espaces superposés", () => {
  const matches = findContainingAirspaces({
    position,
    airspaces: collection(
      feature(properties({ id: "ctr", type: 4 })),
      feature(properties({ id: "tma", type: 7 })),
    ),
    altitudeMeters: 300,
    verticalAccuracyMeters: 10,
  });
  assert.equal(matches.length, 2);
});

test("classe une CTR avant une TMA", () => {
  const matches = findContainingAirspaces({
    position,
    airspaces: collection(
      feature(properties({ id: "tma", type: 7 })),
      feature(properties({ id: "ctr", type: 4 })),
    ),
    altitudeMeters: 300,
    verticalAccuracyMeters: 10,
  });
  assert.deepEqual(
    matches.map(({ airspace }) => airspace.airspaceId),
    ["ctr", "tma"],
  );
});

test("classe une TMA avant un secteur FIS", () => {
  assert.ok(getAirspaceDisplayPriority(7) < getAirspaceDisplayPriority(33));
});

test("classe une zone réglementée avant une CTR", () => {
  assert.ok(getAirspaceDisplayPriority(1) < getAirspaceDisplayPriority(4));
});

test("conserve horizontalement un espace lorsque le pilote est sous le plancher", () => {
  const [match] = findContainingAirspaces({
    position,
    airspaces: collection(
      feature(
        properties({
          id: "high",
          lowerLimit: { value: 3000, unit: 1, referenceDatum: 1 },
        }),
      ),
    ),
    altitudeMeters: 200,
    verticalAccuracyMeters: 10,
  });
  assert.equal(match.verticalContext.state, "BELOW");
  assert.equal(match.isVerticallyConfirmed, false);
});

test("conserve un espace dont le contexte vertical est inconnu", () => {
  const [match] = findContainingAirspaces({
    position,
    airspaces: collection(
      feature(
        properties({
          id: "agl",
          lowerLimit: { value: 500, unit: 1, referenceDatum: 0 },
          upperLimit: { value: 65, unit: 6, referenceDatum: 2 },
        }),
      ),
    ),
    altitudeMeters: 500,
    verticalAccuracyMeters: 10,
  });
  assert.equal(match.verticalContext.state, "UNKNOWN");
});

test("retourne un contexte indisponible sans GPS", () => {
  const context = buildFlightContext({
    gps: {
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      horizontalAccuracyMeters: null,
      verticalAccuracyMeters: null,
      timestamp: null,
      status: "UNAVAILABLE",
    },
    airspaces: collection(),
    loadedCoverage: [],
    airspaceDataAvailable: false,
  });
  assert.equal(context.airspace.status, "UNAVAILABLE");
  assert.equal(context.airspace.current, null);
});

test("attribue une priorité neutre aux types inconnus", () => {
  assert.equal(getAirspaceDisplayPriority(999), 500);
});

test("utilise un ordre stable par identifiant à priorité équivalente", () => {
  const matches = findContainingAirspaces({
    position,
    airspaces: collection(
      feature(properties({ id: "bravo", type: 999 })),
      feature(properties({ id: "alpha", type: 999 })),
    ),
    altitudeMeters: 300,
    verticalAccuracyMeters: 10,
  });
  assert.deepEqual(
    matches.map(({ airspace }) => airspace.airspaceId),
    ["alpha", "bravo"],
  );
});

test("ajouter une région explorée ne change pas le contexte GPS", () => {
  const lille = feature(properties({ id: "lille", type: 4 }));
  const toulouse = feature(
    properties({ id: "toulouse", type: 4 }),
    {
      type: "Polygon",
      coordinates: [
        [
          [1, 43],
          [2, 43],
          [2, 44],
          [1, 43],
        ],
      ],
    },
  );
  const gps = {
    latitude: 50,
    longitude: 3,
    altitudeMeters: 300,
    horizontalAccuracyMeters: 5,
    verticalAccuracyMeters: 10,
    timestamp: 1,
    status: "ACTIVE",
  };
  const loadedCoverage = [
    { latitude: 50, longitude: 3, radiusMeters: 45_000 },
  ];
  const before = buildFlightContext({
    gps,
    airspaces: collection(lille),
    loadedCoverage,
    airspaceDataAvailable: true,
  });
  const after = buildFlightContext({
    gps,
    airspaces: collection(lille, toulouse),
    loadedCoverage,
    airspaceDataAvailable: true,
  });
  assert.equal(before.airspace.current?.airspace.airspaceId, "lille");
  assert.equal(after.airspace.current?.airspace.airspaceId, "lille");
});

test("la sélection manuelle contextuelle ne modifie pas l’espace actuel", () => {
  const ctr = feature(properties({ id: "ctr", type: 4 }));
  const siv = feature(properties({ id: "siv", type: 33 }));
  const airspaces = collection(siv, ctr);
  const input = {
    gps: {
      latitude: position.latitude,
      longitude: position.longitude,
      altitudeMeters: 300,
      horizontalAccuracyMeters: 10,
      verticalAccuracyMeters: 10,
      timestamp: 1,
      status: "ACTIVE",
    },
    airspaces,
    loadedCoverage: [
      {
        latitude: position.latitude,
        longitude: position.longitude,
        radiusMeters: 45_000,
      },
    ],
    airspaceDataAvailable: true,
  };
  const before = buildFlightContext(input);

  const selected = selectAirspaceForMapClick({
    candidates: [
      { airspace: siv.properties, geometry: siv.geometry },
      { airspace: ctr.properties, geometry: ctr.geometry },
    ],
    zoom: 5,
  });
  const after = buildFlightContext(input);

  assert.equal(selected.airspace.airspaceId, "siv");
  assert.equal(before.airspace.current.airspace.airspaceId, "ctr");
  assert.equal(after.airspace.current.airspace.airspaceId, "ctr");
});
