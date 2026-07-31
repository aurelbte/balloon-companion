import test from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_ORIENTATION,
  TWO_DIMENSIONAL_MAP_OPTIONS,
} from "./mapInteraction.ts";

test("autorise la rotation tout en verrouillant strictement la carte en 2D", () => {
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.dragRotate, true);
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.touchZoomRotate, true);
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.touchPitch, false);
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.pitchWithRotate, false);
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.minPitch, 0);
  assert.equal(TWO_DIMENSIONAL_MAP_OPTIONS.maxPitch, 0);
});

test("la vue de référence restaure le nord et un pitch nul", () => {
  assert.deepEqual(REFERENCE_ORIENTATION, { bearing: 0, pitch: 0 });
});
