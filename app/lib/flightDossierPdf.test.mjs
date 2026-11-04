import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { createFlightDossierPdf, wrapDossierText } from './flightDossierPdf.ts';
import { exportFlightDossier } from './flightDossierExport.ts';
import { renderPassengerMemoryMap } from './passengerMemoryMap.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
const png = new Uint8Array(readFileSync(new URL('../../public/branding/balloon-companion-logo-passenger.png', import.meta.url)));
const map = { png, background: 'NEUTRAL' };
const contents = page => {
  const streams = page.node.Contents();
  const values = typeof streams.size === 'function' ? Array.from({length: streams.size()}, (_, i) => streams.lookup(i)) : [streams];
  return values.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString()).join('\n');
};
const hasAscii = (text, value) => text.includes(Buffer.from(value).toString('hex').toUpperCase());

test('A4 PDF includes every section and the full long raw message across automatically numbered pages', async () => {
  const input = await dossierPdfFixture({ longRaw: true, kubicek: true });
  const bytes = await createFlightDossierPdf(input, map);
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 7);
  assert.match(document.getSubject(), /arome:strategie-selectionnee/);
  const pages = document.getPages();
  for (const page of pages) { assert.equal(page.getWidth(), 595.28); assert.equal(page.getHeight(), 841.89); }
  const text = pages.map(contents).join('\n');
  for (const label of ['FIN-MESSAGE-INTEGRAL', 'LFQQ', 'NON V', 'Lift Units', '118.550', 'UTC', 'indisponible']) assert.ok(hasAscii(text, label), label);
  pages.forEach((page, index) => assert.ok(hasAscii(contents(page), `${index + 1} / ${pages.length}`)));
  assert.ok(hasAscii(contents(pages.at(-1)), 'Carte -')); // Dedicated final map page.
});

test('wrapping preserves a long token and unsupported characters without overflowing or ellipsis', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const token = 'ABCDEFGH'.repeat(400);
  const lines = wrapDossierText(token, font, 9, 70);
  assert.equal(lines.join(''), token);
  assert.ok(lines.every(line => font.widthOfTextAtSize(line, 9) <= 70));
  assert.match(wrapDossierText('Station 气球', font, 9, 300).join(''), /U\+6C14U\+7403/);
});

test('missing weather, operations and map are explicit and do not prevent a partial dossier', async () => {
  const { dossier } = await dossierPdfFixture();
  delete dossier.operations;
  const bytes = await createFlightDossierPdf({ dossier, weather: null, weatherError: 'SOURCE-HORS-LIGNE' }, { error: 'CARTE-INDISPONIBLE' });
  const document = await PDFDocument.load(bytes);
  const text = document.getPages().map(contents).join('\n');
  assert.ok(hasAscii(text, 'SOURCE-HORS-LIGNE'));
  assert.ok(hasAscii(text, 'CARTE-INDISPONIBLE'));
  await assert.rejects(createFlightDossierPdf({ dossier, weather: { traceId: 'other', weatherModel: dossier.model.providerModelId } }, map), /stratégie sélectionnée/);
});

test('download receives only selected points; failure and cancellation never download a stale PDF', async () => {
  const input = await dossierPdfFixture();
  let downloads = 0;
  const environment = { renderMap: async points => { assert.equal(points, input.dossier.points); return map; }, createPdf: async () => new Uint8Array([1,2,3]), download: (bytes, filename) => { downloads++; assert.match(filename, /^dossier-vol_2026-11-05_arome-strategie-selectionnee\.pdf$/); } };
  assert.equal(downloads, 0);
  await exportFlightDossier(input, undefined, environment);
  assert.equal(downloads, 1);
  await assert.rejects(exportFlightDossier(input, undefined, { ...environment, createPdf: async () => { throw Error('pdf failure'); } }), /pdf failure/);
  assert.equal(downloads, 1);
  const controller = new AbortController();
  await assert.rejects(exportFlightDossier(input, controller.signal, { ...environment, createPdf: async () => { controller.abort(); return new Uint8Array(); } }), { name: 'AbortError' });
  assert.equal(downloads, 1);
  let fallback;
  await exportFlightDossier(input, undefined, { ...environment, renderMap: async () => { throw Error('Canvas absent'); }, createPdf: async (_, value) => { fallback = value; return new Uint8Array(); } });
  assert.equal(fallback.error, 'Canvas absent');
});

test('dossier map is portrait with selected endpoints, scale and attribution; legacy renderer stays landscape', async () => {
  const originalDocument = globalThis.document;
  const labels = [], paths = [];
  let canvas;
  const context = new Proxy({}, { get: (_, name) => name === 'fillText' ? text => labels.push(text) : name === 'lineTo' ? (x,y) => paths.push([x,y]) : () => undefined, set: () => true });
  globalThis.document = { createElement: () => (canvas = { width: 0, height: 0, getContext: () => context, toBlob: callback => callback(new Blob([png])) }) };
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const points = [{ latitude: 50.68, longitude: 3.05 }, { latitude: 50.74, longitude: 3.13 }];
  try {
    await renderPassengerMemoryMap(points, {});
    assert.equal(canvas.height, 1850);
    assert.ok(labels.includes('D')); assert.ok(labels.includes('A'));
    assert.ok(labels.some(label => /\(au centre\)/.test(label)));
    assert.ok(labels.includes('Trajectoire prévue - fond indisponible'));
    assert.ok(paths.every(([x,y]) => x >= 0 && x <= 1400 && y >= 0 && y <= 1850));
    await renderPassengerMemoryMap(points);
    assert.equal(canvas.height, 570);
    await assert.rejects(renderPassengerMemoryMap([{latitude: 89, longitude: 0}], {}), /Projection cartographique/);
  } finally {
    globalThis.document = originalDocument;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
  }
});

test('a single oversized information-table cell continues across pages without dropping its end', async () => {
  const input = await dossierPdfFixture();
  input.dossier.strategyLabel = 'Stratégie '.repeat(1300) + ' TABLE-MARKER-FIN';
  const document = await PDFDocument.load(await createFlightDossierPdf(input, map));
  const text = document.getPages().map(contents).join('\n');
  assert.ok(hasAscii(text, 'TABLE-MARKER-FIN'));
  assert.ok(document.getPageCount() > 7);
});
