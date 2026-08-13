import assert from "node:assert/strict";
import test from "node:test";
import { calculateSunTimes } from "./weather/sunTimes.ts";

test("calcule les heures solaires pour la date affichée et le fuseau du lieu", () => {
  assert.deepEqual(calculateSunTimes("2026-08-13", 50.686341, 3.079865, "Europe/Paris"), { sunrise: "06:31", sunset: "21:12" });
  assert.deepEqual(calculateSunTimes("2026-08-16", 50.686341, 3.079865, "Europe/Paris"), { sunrise: "06:36", sunset: "21:06" });
});

test("le fuseau du lieu pilote le formatage et les cas indisponibles restent neutres", () => {
  const paris = calculateSunTimes("2026-08-13", 43.6293, 1.3638, "Europe/Paris");
  const utc = calculateSunTimes("2026-08-13", 43.6293, 1.3638, "UTC");
  assert.notDeepEqual(paris, utc);
  assert.equal(calculateSunTimes(undefined, 43.6293, 1.3638, "Europe/Paris"), null);
});
