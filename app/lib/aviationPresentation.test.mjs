import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { metarDisplay, tafPeriods, tafValidity } from "../weather/aviationPresentation.ts";

test("présente les groupes METAR sans modifier la chaîne brute", () => {
  const raw = "LFQO 121530Z 24008G13KT 9999 SCT025 BKN040 23/12 Q1015";
  assert.deepEqual(metarDisplay(raw), { wind: "24008G13KT", visibility: "9999", clouds: "SCT025 BKN040", temperature: "23", dewPoint: "12", qnh: "Q1015" });
});

test("structure la validité et les périodes TAF sans générer de résumé", () => {
  const raw = "TAF LFQO 121100Z 1212/1312 24008KT 9999 SCT025 TEMPO 1214/1218 4000 BKN012 FM122000 28005KT CAVOK";
  assert.equal(tafValidity(raw), "1212/1312");
  const periods = tafPeriods(raw);
  assert.deepEqual(periods.map(({ label }) => label), ["Période initiale", "TEMPO", "FM122000"]);
  assert.equal(periods[0].wind, "24008KT");
  assert.equal(periods[2].visibility, "CAVOK");
});

test("les panneaux bruts restent repliés par défaut", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<summary>METAR brut<\/summary>/);
  assert.match(page, /<summary>TAF brut<\/summary>/);
  assert.doesNotMatch(page, /<details open/);
});
