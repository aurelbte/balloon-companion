import assert from "node:assert/strict";
import test from "node:test";
import {
  getAirspaceTileForPosition,
  getAirspaceTilesForBounds,
  getFranceAirspaceTiles,
} from "./airspaceTiles.ts";

test("une même position produit toujours le même tileId", () => {
  assert.equal(
    getAirspaceTileForPosition(50.631, 3.058).tileId,
    getAirspaceTileForPosition(50.631, 3.058).tileId,
  );
});

test("une position sur une limite appartient déterministement à la tuile suivante", () => {
  const tile = getAirspaceTileForPosition(50.5, 3);
  assert.equal(tile.bounds.south, 50.5);
  assert.equal(tile.bounds.west, 3);
});

test("une bbox est couverte sans doublon", () => {
  const tiles = getAirspaceTilesForBounds({
    west: 2.9,
    south: 50.4,
    east: 3.6,
    north: 51.1,
  });
  assert.ok(tiles.length > 1);
  assert.equal(new Set(tiles.map((tile) => tile.tileId)).size, tiles.length);
});

test("la couverture nationale inclut métropole et Corse", () => {
  const tiles = getFranceAirspaceTiles();
  assert.equal(tiles.length, 547);
  assert.ok(tiles.some((tile) => tile.bounds.west <= -5));
  assert.ok(tiles.some((tile) => tile.bounds.west >= 8.5 && tile.bounds.south < 42));
});
