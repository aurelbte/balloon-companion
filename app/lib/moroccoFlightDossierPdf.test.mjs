import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFCheckBox, decodePDFRawStream } from 'pdf-lib';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { exportMoroccoFlightDossier } from './moroccoFlightDossierExport.ts';
import { createFlightDossierPdf } from './flightDossierPdf.ts';
import { moroccoChecklistBase64 } from './moroccoChecklistAsset.ts';
import { MOROCCO_CHECKLIST_GROUPS } from './moroccoChecklistFields.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
const map = { error: 'Carte hors ligne' };
const contents = page => {
  const streams = page.node.Contents();
  const values = typeof streams.size === 'function' ? Array.from({ length: streams.size() }, (_, i) => streams.lookup(i)) : [streams];
  return values.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString()).join('\n');
};
const hasText = (page, value) => contents(page).includes(Buffer.from(value).toString('hex').toUpperCase());

test('Morocco prepends both original AVB pages and adds 39 independent editable checkbox widgets', async () => {
  const input = await dossierPdfFixture();
  const source = await PDFDocument.load(moroccoChecklistBase64);
  const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, map));
  assert.equal(pdf.getForm().getFields().length, 39);
  for (let index = 0; index < 2; index++) {
    const page = pdf.getPage(index);
    assert.deepEqual(page.getSize(), source.getPage(index).getSize());
    assert.ok(contents(page).includes(contents(source.getPage(index))));
    assert.ok(page.node.Resources().lookup(PDFName.of('XObject'))); // Source images/logo retained.
    assert.equal(page.node.Annots().size(), index === 0 ? 20 : 19);
  }
  for (const group of MOROCCO_CHECKLIST_GROUPS) for (const [i] of group.rows.entries()) {
    const field = pdf.getForm().getCheckBox(`avb-${group.name}-${i + 1}`);
    assert.ok(field instanceof PDFCheckBox);
    assert.equal(field.isChecked(), false);
    assert.equal(field.isReadOnly(), false);
    assert.equal(field.acroField.getWidgets().length, 1);
    const widget = field.acroField.getWidgets()[0];
    assert.equal(widget.P().toString(), pdf.getPage(group.page).ref.toString());
    assert.equal(widget.getAppearanceState().toString(), '/Off');
    const normal = widget.getAppearances().normal;
    assert.ok(normal.has(PDFName.of('Off')));
    assert.ok(normal.has(PDFName.of('Yes')));
    assert.equal(field.isExported(), true);
  }
  assert.ok(hasText(pdf.getPage(2), '05/11/2026'));
  assert.match(pdf.getTitle(), /Maroc - 05\/11\/2026/);
  assert.ok(pdf.getPage(2).node.Resources().lookup(PDFName.of('XObject'))); // Reused AVB logo.
  assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false);
});

test('every checkbox can be checked, saved, reopened, unchecked and saved again without a service', async () => {
  const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(await dossierPdfFixture(), map));
  for (const field of pdf.getForm().getFields()) field.check();
  const checked = await PDFDocument.load(await pdf.save());
  for (const field of checked.getForm().getFields()) {
    assert.equal(field.isChecked(), true);
    assert.equal(field.acroField.getValue().toString(), '/Yes');
    assert.equal(field.acroField.getWidgets()[0].getAppearanceState().toString(), '/Yes');
  }
  // Fields are independent, including on the second page.
  checked.getForm().getCheckBox('avb-enveloppe-1').uncheck();
  assert.equal(checked.getForm().getCheckBox('avb-enveloppe-2').isChecked(), true);
  assert.equal(checked.getForm().getCheckBox('avb-equipements-detail-9').isChecked(), true);
  for (const field of checked.getForm().getFields()) field.uncheck();
  const cleared = await PDFDocument.load(await checked.save());
  assert.equal(cleared.getForm().getFields().length, 39);
  for (const field of cleared.getForm().getFields()) {
    assert.equal(field.isChecked(), false);
    assert.equal(field.acroField.getValue().toString(), '/Off');
    assert.equal(field.acroField.getWidgets()[0].getAppearanceState().toString(), '/Off');
  }
});

test('scheduled date uses the launch timezone, and France keeps its original title and no AVB form', async () => {
  const input = await dossierPdfFixture();
  input.dossier.startedAt = '2026-11-05T23:30:00Z';
  input.dossier.launchTimeZone = 'Africa/Casablanca';
  const maroc = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, map));
  assert.match(maroc.getTitle(), /06\/11\/2026/);
  assert.ok(hasText(maroc.getPage(2), '06/11/2026'));
  const france = await PDFDocument.load(await createFlightDossierPdf(input, map));
  assert.match(france.getTitle(), /^Dossier de vol -/);
  assert.equal(france.getForm().getFields().length, 0);
  assert.ok(hasText(france.getPage(0), 'Dossier de vol'));
  assert.equal(maroc.getPageCount(), france.getPageCount() + 2);
});

test('Morocco export has its own filename and respects failures and cancellation', async () => {
  const input = await dossierPdfFixture();
  let downloads = 0;
  const env = {
    renderMap: async points => { assert.equal(points, input.dossier.points); return map; },
    createPdf: createMoroccoFlightDossierPdf,
    download: (bytes, filename) => { assert.ok(bytes.length > 1000); assert.match(filename, /^preparation-maroc_2026-11-05_/); downloads++; },
  };
  await exportMoroccoFlightDossier(input, undefined, env);
  assert.equal(downloads, 1);
  await assert.rejects(exportMoroccoFlightDossier(input, undefined, { ...env, createPdf: async () => { throw Error('PDF impossible'); } }), /PDF impossible/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(exportMoroccoFlightDossier(input, controller.signal, env), { name: 'AbortError' });
  assert.equal(downloads, 1);
});
