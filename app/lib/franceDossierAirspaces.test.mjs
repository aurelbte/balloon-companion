import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { createFlightDossierPdf, franceDossierAirspaceRows } from './flightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { normalizeOpenAipAltitudeLimit } from './airspaceAltitude.ts';
const map = { error: 'Carte indisponible (test)' };
const textOf = page => {
  const streams = page.node.Contents();
  return Array.from({length: streams.size()}, (_, i) => Buffer.from(decodePDFRawStream(streams.lookup(i)).decode()).toString()).join('\n');
};
const has = (text, value) => text.includes(Buffer.from(value, 'latin1').toString('hex').toUpperCase());
const zone = (source, id) => ({ ...structuredClone(source), airspace: { ...source.airspace, id, airspaceId: id, airspaceCompositeKey: id, name: id } });

test('one row per stable zone identity, original limits and all available frequencies retained without mutation', async () => {
  const input = await dossierPdfFixture();
  const original = input.dossier.operations.airspaces.uncertain[0];
  const first = zone(original, 'ZONE-A');
  first.floor = normalizeOpenAipAltitudeLimit({ value: 0, unit: 1, referenceDatum: 0 });
  first.ceiling = normalizeOpenAipAltitudeLimit({ value: 75, unit: 6, referenceDatum: 1 });
  first.frequencies.values = [{ value: '118.550', unit: 2 }];
  const duplicate = structuredClone(first);
  duplicate.frequencies.values.push({ value: '120.000', unit: 2 });
  const second = zone(original, 'ZONE-B');
  second.floor = normalizeOpenAipAltitudeLimit({ value: 1500, unit: 1, referenceDatum: 0 });
  second.ceiling = normalizeOpenAipAltitudeLimit({ value: 2000, unit: 0, referenceDatum: 1 });
  second.frequencies.values = [];
  const airspaces = { confirmed: [first], uncertain: [duplicate, second] };
  const before = structuredClone(airspaces);
  assert.deepEqual(franceDossierAirspaceRows(airspaces), [
    ['ZONE-A *', 'SFC', 'FL 075', '118.550 / 120.000'],
    ['ZONE-B *', '1500 ft AGL', '2000 m AMSL', 'Non disponible'],
  ]);
  assert.deepEqual(airspaces, before);
  // Matching names alone must never collapse distinct identified zones.
  second.airspace.name = first.airspace.name;
  assert.equal(franceDossierAirspaceRows(airspaces).length, 2);
});

test('38 unique short zones remain on one page, with every zone and no passage details', async () => {
  const input = await dossierPdfFixture();
  const airspaces = input.dossier.operations.airspaces;
  const original = airspaces.uncertain[0];
  airspaces.uncertain = Array.from({ length: 38 }, (_, i) => zone(original, `ZONE-${String(i).padStart(3, '0')}`));
  const pdf = await PDFDocument.load(await createFlightDossierPdf(input, map));
  const pages = pdf.getPages().map(textOf);
  const sectionPages = pages.filter(text => has(text, 'Espaces traversés et possibles'));
  assert.equal(sectionPages.length, 1);
  const section = sectionPages[0];
  for (const item of airspaces.uncertain) {
    const containing = pages.filter(text => has(text, item.airspace.name + ' *'));
    assert.equal(containing.length, 1, item.airspace.name);
    assert.equal(containing[0], section);
  }
  for (const text of ['Zone', 'Plancher', 'Plafond', 'Fréquence', 'NOTAM', 'traversée non confirmée']) assert.ok(has(section, text), text);
  for (const text of ['Entrée locale', 'Sortie locale', 'Qualification', 'Activité publiée', 'Segments avec horaires', 'Intersection :', 'Incertitude :']) assert.equal(has(section, text), false, text);
  assert.ok(has(pages.at(-1), 'Carte -'));
});

test('overflow or an unbounded name rejects the export explicitly instead of dropping or clipping a zone', async () => {
  const input = await dossierPdfFixture();
  const airspaces = input.dossier.operations.airspaces;
  const original = airspaces.uncertain[0];
  airspaces.uncertain = Array.from({ length: 60 }, (_, i) => zone(original, `ZONE-${i}`));
  await assert.rejects(createFlightDossierPdf(input, map), /60 zones uniques.*une page lisible.*Aucune zone n'a été retirée/);
  airspaces.uncertain = [zone(original, 'ZONE-LONGUE '.repeat(1000))];
  await assert.rejects(createFlightDossierPdf(input, map), /1 zones uniques.*une page lisible/);
});

test('missing and empty airspace data remain explicit and retain the official-publications note', async () => {
  for (const missing of [true, false]) {
    const input = await dossierPdfFixture();
    if (missing) delete input.dossier.operations.airspaces;
    else { input.dossier.operations.airspaces.confirmed = []; input.dossier.operations.airspaces.uncertain = []; }
    const pdf = await PDFDocument.load(await createFlightDossierPdf(input, map));
    const text = pdf.getPages().map(textOf).join('\n');
    assert.ok(has(text, missing ? 'Non disponible' : 'couverture non exhaustive'));
    assert.ok(has(text, 'publications officielles et NOTAM'));
  }
});
