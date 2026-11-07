import test from "node:test";
import assert from "node:assert/strict";
import { calculateFm04LiftKgPer1000Ft3 } from "./fm04Lift.ts";

const H65_VOLUME_1000_FT3 = 65;

test("FM04 : calcul théorique H-65 à 20 °C, sans assimiler l’écart à une tolérance constructeur", () => {
  const lift = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 20,
    launchElevationMslM: 300,
    maximumAltitudeMslM: 3_000,
  });
  assert.ok(lift !== null);
  assert.equal(lift, 6.560262109776423);
  assert.notEqual(lift, 6.55); // Manual p.5.5 Rev.25; no numerical acceptance tolerance supplied.
  assert.notEqual(lift * H65_VOLUME_1000_FT3, 426);
});

test("FM04 : calcul théorique H-65 à 10 °C distinct de l’approximation graphique", () => {
  const lift = calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 10,
    launchElevationMslM: 300,
    maximumAltitudeMslM: 3_000,
  });
  assert.ok(lift !== null);
  assert.equal(lift, 7.5050825780654185);
  assert.notEqual(lift * H65_VOLUME_1000_FT3, 488);
});

test("FM04 refuse une altitude maximale sous le terrain", () => {
  assert.equal(calculateFm04LiftKgPer1000Ft3({
    groundTemperatureC: 20,
    launchElevationMslM: 500,
    maximumAltitudeMslM: 300,
  }), null);
});
