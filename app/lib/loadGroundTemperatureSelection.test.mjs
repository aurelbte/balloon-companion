import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoadGroundTemperature } from './loadGroundTemperatureSelection.ts';
import { prepareDossierLoad } from './flightDossierOperations.ts';
import { createFlightDossierPdf } from './flightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
const auto = { temperatureC: 12, provider: 'Open-Meteo', sourceModel: 'Open-Meteo', validTime: '2026-11-05T10:00:00Z', forecastRun: 'run' };

test('Auto uses only actual automatic data; manual remains independent across weather refreshes', () => {
  assert.equal(resolveLoadGroundTemperature('auto', '', null), null);
  assert.equal(resolveLoadGroundTemperature('auto', '-4', auto), auto);
  for (const weather of [auto, { ...auto, temperatureC: 20 }, null]) {
    const effective = resolveLoadGroundTemperature('manual', '-4,5', weather, auto.validTime);
    assert.equal(effective.temperatureC, -4.5);
    assert.equal(effective.provider, 'Saisie manuelle');
    assert.equal(effective.forecastRun, ''); // Never invent a weather run.
  }
  assert.equal(resolveLoadGroundTemperature('auto', '-4,5', { ...auto, temperatureC: 20 }).temperatureC, 20);
});

test('empty, malformed and nonfinite manual inputs never fall back to Auto or zero', () => {
  for (const input of ['', ' ', '-', 'abc', '12 °C', 'Infinity', 'NaN', '1e1000', '1,2.3']) assert.equal(resolveLoadGroundTemperature('manual', input, auto), null, input);
  assert.equal(resolveLoadGroundTemperature('manual', '0', null).temperatureC, 0);
  assert.equal(resolveLoadGroundTemperature('manual', '+12.5', null).temperatureC, 12.5);
});

test('effective manual value reaches the unchanged load engine and the PDF with its source, even if load is unavailable', async () => {
  const input = await dossierPdfFixture();
  const groundTemperature = resolveLoadGroundTemperature('manual', '7,5', auto, input.dossier.startedAt);
  const loadInput = buildLoadCalculationInput({ balloon: input.dossier.balloon, occupantsWeightKg: 200, launchElevationMslM: 47, plannedMaximumAltitudeMslM: 1000, groundTemperature });
  let load = prepareDossierLoad(input.dossier.balloon, loadInput);
  assert.equal(load.result.status, 'AVAILABLE');
  assert.equal(load.result.groundTemperatureC, 7.5);
  assert.equal(load.result.groundTemperatureSource, 'Saisie manuelle');
  load = prepareDossierLoad(input.dossier.balloon, { ...loadInput, configurationLimitsConfirmed: false });
  assert.equal(load.status, 'UNAVAILABLE');
  assert.equal(load.temperature.temperatureC, 7.5);
  input.dossier.operations.load = load;
  const pdf = await PDFDocument.load(await createFlightDossierPdf(input, { error: 'Carte indisponible pour ce test' }));
  const content = pdf.getPages().flatMap(page => {
    const contents = page.node.Contents();
    return Array.from({ length: contents.size() }, (_, i) => Buffer.from(decodePDFRawStream(contents.lookup(i)).decode()).toString());
  }).join('\n');
  for (const text of ['Saisie manuelle', '7,5']) assert.ok(content.includes(Buffer.from(text).toString('hex').toUpperCase()), text);
});
