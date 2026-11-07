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


const liftAt = (temperatureC, launchElevationMslM=0, maximumAltitudeMslM=launchElevationMslM) => calculateFm04LiftKgPer1000Ft3({groundTemperatureC:temperatureC,launchElevationMslM,maximumAltitudeMslM});
test("FM04 : limites imprimées incluses, aucun dépassement de température ou altitude",()=>{
  assert.ok(liftAt(40)!==null);
  assert.ok(liftAt(-50,7000)!==null);
  assert.ok(liftAt(0,0,7000)!==null);
  for(const args of [[40.000001],[-50.000001,7000],[0,-0.000001],[0,0,7000.000001],[0,7000.000001]]) assert.equal(liftAt(...args),null,JSON.stringify(args));
});
test("FM04 : la température à l'altitude maximale et les courbes tronquées sont aussi bornées",()=>{
  assert.equal(liftAt(-40,0,2000),null); // -53 C at maximum, although ground temperature is on the axis.
  assert.equal(liftAt(-50),null); // Lift >10: clipped low-altitude curve, no clamping.
  assert.equal(liftAt(40,7000),null); // Lift <4.5: clipped high-altitude curve.
  assert.equal(liftAt(-10,0,3000),null); // Launch point unreadable even if final point fits.
  for(const args of [[NaN],[Infinity],[0,NaN],[0,0,Infinity]]) assert.equal(liftAt(...args),null);
});
