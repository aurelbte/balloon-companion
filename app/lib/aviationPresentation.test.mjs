import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aviationAnalysis, metarDisplay, tafPeriods, tafValidity } from "../weather/aviationPresentation.ts";

test("présente les groupes METAR sans modifier la chaîne brute", () => {
  const raw = "LFQO 121530Z 24008G13KT 9999 SCT025 BKN040 23/12 Q1015";
  assert.deepEqual(metarDisplay(raw), { wind: "Ouest-Sud-Ouest (240°) · 8 kt · rafales 13 kt", visibility: "> 10 km", clouds: "Nuages épars à 2500 ft · Nuages fragmentés à 4000 ft", cavok: false, temperature: "23°C", dewPoint: "12°C", qnh: "1015 hPa" });
  assert.equal(raw, "LFQO 121530Z 24008G13KT 9999 SCT025 BKN040 23/12 Q1015");
});

test("décode CAVOK et les températures négatives sans interprétation", () => {
  const decoded = metarDisplay("LFXX 121200Z 09006KT CAVOK M02/M07 Q1023");
  assert.deepEqual(decoded, { wind: "Est (090°) · 6 kt", cavok: true, temperature: "-2°C", dewPoint: "-7°C", qnh: "1023 hPa" });
  assert.equal(decoded.visibility, undefined);
  assert.equal(decoded.clouds, undefined);
  assert.doesNotMatch(JSON.stringify(decoded), /Aucun nuage significatif|Pas de phénomène météo/);
});

test("conserve uniquement les couches et phénomènes réellement présents", () => {
  const decoded = metarDisplay("LFXX 121200Z 12005KT 4000 -RA BR SCT012 BKN025 12/10 Q1012");
  assert.equal(decoded.clouds, "Nuages épars à 1200 ft · Nuages fragmentés à 2500 ft");
  assert.equal(decoded.phenomena, "Pluie · Brume");
});

test("conserve exclusivement les nœuds pour les vents Aviation", () => {
  assert.equal(metarDisplay("LFXX 121200Z VRB03G09KT CAVOK 12/10 Q1012").wind, "Variable · 3 kt · rafales 9 kt");
  const taf = tafPeriods("TAF LFXX 121100Z 1212/1312 04003KT CAVOK TEMPO 1214/1218 08008G14KT 5000 RA BECMG 1218/1220 10010KT SCT020 FM122100 12012KT CAVOK");
  assert.deepEqual(taf.map(({ wind }) => wind), ["Nord-Est (040°) · 3 kt", "Est (080°) · 8 kt · rafales 14 kt", "Est (100°) · 10 kt", "Est-Sud-Est (120°) · 12 kt"]);
  assert.doesNotMatch(JSON.stringify(taf), /km\/h/);
});

test("structure la validité et les périodes TAF sans générer de résumé", () => {
  const raw = "TAF LFQO 121100Z 1212/1312 24008KT 9999 SCT025 TEMPO 1214/1218 4000 BKN012 FM122000 28005KT CAVOK";
  assert.equal(tafValidity(raw), "du 12 à 12h au 13 à 12h UTC");
  const periods = tafPeriods(raw);
  assert.deepEqual(periods.map(({ label }) => label), ["Période initiale", "Temporairement", "À partir du 12 à 20h UTC"]);
  assert.equal(periods[0].wind, "Ouest-Sud-Ouest (240°) · 8 kt");
  assert.equal(periods[2].cavok, true);
  assert.equal(periods[2].visibility, undefined);
  assert.equal(periods[2].clouds, undefined);
  assert.equal(raw, "TAF LFQO 121100Z 1212/1312 24008KT 9999 SCT025 TEMPO 1214/1218 4000 BKN012 FM122000 28005KT CAVOK");
});

test("les panneaux bruts restent repliés par défaut", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<summary>METAR brut<\/summary>/);
  assert.match(page, /<summary>TAF brut<\/summary>/);
  assert.doesNotMatch(page, /<details open/);
});

test("le TAF présente une chronologie verticale et uniquement ses conditions disponibles", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../weather/weather.module.css", import.meta.url), "utf8");
  assert.match(page, /Conditions initiales/);
  assert.match(page, /period\.wind\.split/);
  assert.match(page, /period\.cavok &&/);
  assert.match(page, /period\.clouds &&/);
  assert.match(page, /period\.phenomena &&/);
  assert.match(styles, /\.tafPeriods section \{ display: grid/);
  assert.doesNotMatch(styles, /repeat\(3, minmax\(0, 1fr\)\)/);
});

test("produit une analyse descriptive courte depuis les seuls METAR et TAF", () => {
  const text = aviationAnalysis("LFQO 121530Z 09006KT CAVOK 30/07 Q1023", "TAF LFQO 121100Z 1212/1318 07012G15KT 5000 BR TEMPO 1218/1222 3000 RA BKN012");
  assert.match(text, /vent moyen se renforce/);
  assert.match(text, /rafales atteignent 15 kt/);
  assert.match(text, /baisse de visibilité/);
  assert.match(text, /brouillard ou de la brume/);
  assert.ok(text.length <= 300);
  assert.ok(text.split(".").filter(Boolean).length <= 4);
  assert.doesNotMatch(text, /vous pouvez voler|vol conseillé|vol déconseillé|conditions favorables|conditions dangereuses|\b(?:OK|GO|NO GO)\b/i);
});
