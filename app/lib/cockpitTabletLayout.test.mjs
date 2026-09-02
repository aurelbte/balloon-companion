import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/cockpit/Cockpit.module.css", import.meta.url), "utf8");

test("le Cockpit mobile conserve son layout par défaut", () => {
  assert.match(styles, /\.layout\s*\{[\s\S]*?max-width: 440px/);
  assert.match(styles, /\.pair\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(page, /useMediaQuery|window\.innerWidth|screen\.orientation/);
});

test("l'iPad portrait élargit le Cockpit sans étirer les cartes de synthèse", () => {
  assert.match(styles, /@media \(min-width: 700px\) and \(min-height: 700px\) and \(orientation: portrait\)/);
  assert.match(styles, /max-width: 720px/);
  assert.match(styles, /\.summaryPair \.summaryCard\s*\{\s*min-height: 0/);
});

test("l'iPad paysage place cadran et cartes dans deux zones au-dessus de la navigation", () => {
  assert.match(page, /styles\.operationalPair/);
  assert.match(page, /styles\.summaryPair/);
  assert.match(styles, /@media \(min-width: 900px\) and \(min-height: 650px\) and \(orientation: landscape\)/);
  assert.match(styles, /grid-template-columns: minmax\(300px, 0\.85fr\) minmax\(500px, 1\.45fr\)/);
  assert.match(styles, /width: min\(calc\(100% - 48px\), 1180px\)/);
  assert.match(styles, /grid-template-rows: auto minmax\(0, 1fr\) auto auto auto auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.header\s*\{[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(styles, /\.hero\s*\{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 2 \/ 8/);
  assert.match(styles, /\.operationalPair\s*\{[\s\S]*?grid-column: 2/);
  assert.match(styles, /\.summaryPair\s*\{[\s\S]*?grid-column: 2/);
  assert.match(styles, /\.cta\s*\{[\s\S]*?grid-column: 2;[\s\S]*?width: 100%/);
});

test("le cadran paysage ne grandit que sur une hauteur de tablette suffisante", () => {
  assert.match(styles, /@media \(min-width: 900px\) and \(min-height: 720px\) and \(orientation: landscape\)/);
  assert.match(styles, /\.ringInstrument\s*\{\s*width: 342px;\s*height: 297px/);
  assert.match(styles, /\.ringDial\s*\{\s*width: 275px;\s*height: 275px/);
});
