import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");

test("toute la tuile Export ouvre le dialogue au toucher et au clavier", () => {
  assert.match(source, /aria-label="Ouvrir les options d’export du vol"/);
  assert.match(source, /onClick=\{\(\) => setExportDialogOpen\(true\)\}/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(source, /<FlightExportDialog/);
});

test("le dialogue expose le souvenir PDF, GPX et BCFLIGHT", () => {
  const dialog = readFileSync(new URL("../components/journal/FlightExportDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /Souvenir passagers/);
  assert.match(dialog, /onPreparePassengerMemory/);
  assert.doesNotMatch(dialog, /Bientôt disponible/);
  assert.match(dialog, /Trace GPX/);
  assert.match(dialog, /Fichier Balloon Companion/);
  assert.match(source, /await exportGpx\(recordedFlight/);
  assert.match(source, /await exportBcFlight\(await loadExportFlight\(\)\)/);
  assert.match(source, /<article className=\{`\$\{styles\.moduleCard\} \$\{styles\.moduleLink\}`\}/);
});

test("le souvenir ouvre une préparation avec durée modifiable avant génération", () => {
  const preparation = readFileSync(new URL("../components/journal/PassengerMemoryDialog.tsx", import.meta.url), "utf8");
  assert.match(preparation, /Souvenir de votre vol/);
  assert.match(preparation, /Durée du vol/);
  assert.match(preparation, /Créer le souvenir/);
  assert.match(preparation, /safe-area-inset-bottom/);
  assert.match(source, /formatPassengerMemoryDuration\(passengerMemoryFlight\.summary\.durationSeconds\)/);
  assert.match(source, /pilot: auth\.user/);
});
