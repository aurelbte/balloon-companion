import assert from "node:assert/strict";
import test from "node:test";
import {
  selectAirspaceForMapClick,
  sortAirspacesForMapClick,
} from "./airspaceMapSelection.ts";

function geometry(size) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
        [0, 0],
      ],
    ],
  };
}

function candidate(id, type, name = id, size = 2) {
  return {
    airspace: { airspaceId: id, id, type, name },
    geometry: geometry(size),
  };
}

function selectedId(candidates, zoom) {
  return selectAirspaceForMapClick({ candidates, zoom })?.airspace.airspaceId;
}

test("NATIONAL privilégie un SIV au FIR et conserve le FIR seul", () => {
  const siv = candidate("siv", 33, "SIV LILLE");
  const fir = candidate("fir", 10, "FIR PARIS", 20);
  assert.equal(selectedId([fir, siv], 5), "siv");
  assert.equal(selectedId([fir], 5), "fir");
});

test("REGIONAL privilégie TMA au SIV puis une zone R à la TMA", () => {
  const siv = candidate("siv", 33);
  const tma = candidate("tma", 7);
  const restricted = candidate("r", 1);
  assert.equal(selectedId([siv, tma], 7), "tma");
  assert.equal(selectedId([tma, restricted], 7), "r");
});

test("LOCAL privilégie CTR à TMA/SIV puis une zone R à la CTR", () => {
  const siv = candidate("siv", 33);
  const tma = candidate("tma", 7);
  const ctr = candidate("ctr", 4);
  const restricted = candidate("r", 1);
  assert.equal(selectedId([siv, tma, ctr], 10), "ctr");
  assert.equal(selectedId([ctr, restricted], 10), "r");
});

test("deux SIV utilisent la plus petite géométrie puis airspaceId", () => {
  const large = candidate("large", 33, "SIV LARGE", 4);
  const bravo = candidate("bravo", 33, "SIV PETIT", 1);
  const alpha = candidate("alpha", 33, "SIV PETIT", 1);
  assert.deepEqual(
    sortAirspacesForMapClick({
      candidates: [large, bravo, alpha],
      zoom: 5,
    }).map(({ airspace }) => airspace.airspaceId),
    ["alpha", "bravo", "large"],
  );
});

test("l’ordre est stable quel que soit l’ordre d’entrée", () => {
  const candidates = [
    candidate("siv", 33),
    candidate("tma", 7),
    candidate("r", 1),
  ];
  const forward = sortAirspacesForMapClick({ candidates, zoom: 7 });
  const reverse = sortAirspacesForMapClick({
    candidates: [...candidates].reverse(),
    zoom: 7,
  });
  assert.deepEqual(
    forward.map(({ airspace }) => airspace.airspaceId),
    reverse.map(({ airspace }) => airspace.airspaceId),
  );
});
