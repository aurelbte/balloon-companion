import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");

test("la tuile Export possède un onClick qui exécute son gestionnaire", () => {
  assert.match(source, /const handleExportTileClick = async \(\) =>/);
  assert.match(source, /onClick=\{\(\) => void handleExportTileClick\(\)\}/);
  assert.match(source, /getFlight\(flight\.id\)/);
  assert.match(source, /await exportBcFlight\(recordedFlight\)/);
});

test("la tuile utilise exclusivement BCFLIGHT et conserve sa structure", () => {
  assert.doesNotMatch(source, /exportGpx|exportPdf|openExportMenu|setExportMenuOpen/);
  assert.doesNotMatch(source, /GPX · PDF|bientôt disponible/);
  assert.match(source, /<article className=\{`\$\{styles\.moduleCard\} \$\{styles\.moduleLink\}`\}/);
  assert.match(source, /<h2 className=\{styles\.moduleTitle\}><FileDown size=\{16\} \/> Export<\/h2><p className=\{styles\.moduleValue\}>Balloon Companion<\/p><p className=\{styles\.moduleHint\}>\.bcflight<\/p>/);
});
