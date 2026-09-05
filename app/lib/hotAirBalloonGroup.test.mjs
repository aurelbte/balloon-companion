import assert from "node:assert/strict";
import test from "node:test";
import { getHotAirBalloonGroup } from "./hotAirBalloonGroup.ts";

test("les bornes BFCL.010 déterminent uniquement le groupe physique hot-air", () => {
  assert.deepEqual([3400, 3401, 6000, 6001, 10500, 10501].map(getHotAirBalloonGroup), ["A", "B", "B", "C", "C", "D"]);
});

test("un volume absent, non positif ou non fini ne produit aucun groupe", () => {
  assert.deepEqual([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(getHotAirBalloonGroup), [null, null, null, null, null, null]);
});
