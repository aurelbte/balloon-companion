import test from "node:test";
import assert from "node:assert/strict";
import { calculateFm04LiftKgPer1000Ft3 } from "./fm04Lift.ts";

const H65_VOLUME_1000_FT3 = 65;

test("FM04 reproduit l’exemple H-65 à 20 °C dans la précision graphique", () => {
  const lift = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 20,
    launchElevationMslM: 300,
    maximumAltitudeMslM: 3_000,
  });
  assert.ok(lift !== null);
  assert.ok(Math.abs(lift - 6.55) <= 0.02);
  assert.ok(Math.abs(lift * H65_VOLUME_1000_FT3 - 426) <= 1);
});

test("FM04 reproduit le cas H-65 à 10 °C dans la précision graphique", () => {
  const lift = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 10,
    launchElevationMslM: 300,
    maximumAltitudeMslM: 3_000,
  });
  assert.ok(lift !== null);
  assert.ok(Math.abs(lift * H65_VOLUME_1000_FT3 - 488) <= 1);
});

test("FM04 refuse une altitude maximale sous le terrain", () => {
  assert.equal(calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 20,
    launchElevationMslM: 500,
    maximumAltitudeMslM: 300,
  }), null);
});
