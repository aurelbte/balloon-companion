import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../components/journal/JournalFlightMap.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../journal/Journal.module.css", import.meta.url), "utf8");
const statistics = readFileSync(new URL("../components/journal/JournalFlightStatistics.tsx", import.meta.url), "utf8");

test("la fiche mobile tient dans 100dvh au-dessus de la navigation", () => {
  assert.match(detail, /styles\.detailScreen/);
  assert.match(detail, /styles\.detailLayout/);
  assert.match(styles, /\.detailScreen\s*\{[\s\S]*?height: 100dvh/);
  assert.match(styles, /padding-bottom: calc\(60px \+ max\(16px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(styles, /\.detailLayout\s*\{[\s\S]*?grid-template-rows:/);
  assert.match(styles, /@media \(max-height: 740px\)/);
});

test("la carte compacte conserve le plein écran et recadre la trace", () => {
  assert.match(detail, /<JournalFlightMap flight=\{flight\}/);
  assert.match(map, /h-\[clamp\(128px,23dvh,220px\)\]/);
  assert.match(map, /aria-label="Ouvrir la carte plein écran"/);
  assert.match(map, /ResizeObserver/);
  assert.match(map, /compactMapPadding/);
  assert.match(map, /map\.fitBounds/);
});

test("les quatre actions et le carnet restent accessibles", () => {
  for (const label of ["Graphiques", "Statistiques", "Notes", "Export", "Carnet d’ascensions"]) assert.match(detail, new RegExp(label));
  assert.match(detail, /href=\{`\/journal\/\$\{flight\.id\}\/graphs`\}/);
  assert.match(detail, /href=\{`\/journal\/\$\{flight\.id\}\/statistics`\}/);
  assert.match(detail, /onClick=\{\(\) => setNoteEditorOpen\(true\)\}/);
  assert.match(detail, /onClick=\{\(\) => setExportDialogOpen\(true\)\}/);
  assert.match(styles, /grid-template-rows: repeat\(2, clamp\(102px, 12\.5dvh, 124px\)\)/);
  assert.match(styles, /align-self: start/);
  assert.doesNotMatch(styles, /\.detailLayout \.moduleGrid[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(detail, /styles\.exportFormats/);
});

test("la tuile synthétique évite les horaires redondants sans toucher à la vue complète", () => {
  const statisticsTile = detail.match(/<Link href=\{`\/journal\/\$\{flight\.id\}\/statistics`\}[\s\S]*?<\/Link>/)?.[0] ?? "";
  assert.doesNotMatch(statisticsTile, /<span>Départ<\/span>|<span>Arrivée<\/span>/);
  assert.match(statisticsTile, /Altitude max/);
  assert.match(statisticsTile, /Vitesse max/);
  assert.match(statistics, /\["Décollage", flight\.takeoffTime\]/);
  assert.match(statistics, /\["Atterrissage", flight\.landingTime\]/);
  assert.match(statistics, /Altitude maximale/);
  assert.match(statistics, /Vitesse maximale/);
});
