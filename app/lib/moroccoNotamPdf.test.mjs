import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFCheckBox, decodePDFRawStream } from 'pdf-lib';
import { addMoroccoNotamPanel, moroccoNotamWarningGroups, MOROCCO_NOTAM_FIELD } from './moroccoNotamPdf.ts';
import { createMoroccoFlightDossierPdf, wrapDossierText } from './moroccoFlightDossierPdf.ts';
import { exportMoroccoFlightDossier } from './moroccoFlightDossierExport.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';

const content = page => {
  const contents = page.node.Contents();
  return contents ? Array.from({ length: contents.size() }, (_, i) => {
    const stream = contents.lookup(i);
    return Buffer.from(stream.getUnencodedContents ? stream.getUnencodedContents() : decodePDFRawStream(stream).decode()).toString();
  }).join('\n') : '';
};
const hex = text => Buffer.from(text, 'latin1').toString('hex').toUpperCase();
const occurrences = (text, part) => text.split(part).length - 1;
const contentWithForms = page => {
  const objects = page.node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict);
  const forms = (objects?.values() ?? []).map(ref => page.doc.context.lookup(ref))
    .filter(stream => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Form');
  return content(page) + forms.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString()).join('\n');
};
const warnings = [
  'Niveaux sous terrain / incomplets écartés : 180 m AGL - Vent proche du sol incomplet.',
  'Niveaux sous terrain / incomplets écartés : 1000 hPa - Niveau situé sous le terrain.',
  'Niveaux sous terrain / incomplets écartés : 975 hPa, 950 hPa, 900 hPa, 800 hPa - Hauteur géopotentielle absente.',
];
const blocks = () => Array.from({ length: 4 }, (_, index) => ({
  label: `27/11 ${String(index + 5).padStart(2, '0')}:00 UTC+0 (27/11 ${String(index + 5).padStart(2, '0')}:00 UTC)`,
  tables: [{ headers: ['Niveau / référence source', 'Altitude AMSL (m)', 'Direction (°)', 'Vent (km/h)'], widths: [205, 110, 90, 106.28],
    rows: ['10 m AGL', '80 m AGL', '120 m AGL', '925 hPa', '850 hPa', '700 hPa'].map(level => [level, '488', '72', '8']) }],
  missing: [], warnings: [...warnings],
}));
async function pageFixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 10; i++) {
    const page = document.addPage([595.28, 841.89]);
    page.drawText(`Header ${i}`, { x: 42, y: 812, font, size: 11 });
    page.drawText(`Footer ${i}`, { x: 42, y: 24, font, size: 8 });
  }
  return { document, page: document.getPage(6), font, bold };
}
const add = (fixture, data = blocks(), bodyEndY = 54.89) => addMoroccoNotamPanel(fixture.document, fixture.page, fixture.font, fixture.bold, wrapDossierText, { bodyEndY, completeWeatherBlocks: data });

test('proposal B keeps ten pages, fonts, footer, equal 86 x 44 mm areas and empty editable multiline comment', async () => {
  const fixture = await pageFixture(), before = fixture.document.getPages().map(content);
  const result = await add(fixture);
  assert.equal(result.added, true); assert.equal(fixture.document.getPageCount(), 10);
  assert.ok(Math.abs(result.widthMm - 86) < .1); assert.ok(Math.abs(result.heightMm - 44) < .3);
  for (let i = 0; i < 10; i++) if (i !== 6) assert.equal(content(fixture.document.getPage(i)), before[i]);
  const field = fixture.document.getForm().getTextField(MOROCCO_NOTAM_FIELD);
  assert.equal(field.getText() ?? '', ''); assert.equal(field.isMultiline(), true); assert.equal(field.isReadOnly(), false);
  assert.equal(field.acroField.dict.get(PDFName.of('DV')).decodeText(), '');
  const widget = field.acroField.getWidgets()[0];
  assert.equal(widget.P().toString(), fixture.page.ref.toString());
  assert.deepEqual(widget.getRectangle(), { x: 48, y: 58, width: 243.64, height: 124 });
  const page = content(fixture.page);
  assert.match(page, /18 Tf/); assert.match(page, /8\.2 Tf/); assert.match(page, /9 Tf/);
  const titlePosition = page.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<4E4F54414D> Tj/);
  assert.ok(titlePosition);
  assert.ok(Math.abs(Number(titlePosition[1]) + fixture.bold.widthOfTextAtSize('NOTAM', 18) / 2 - 297.64) < .01);
  assert.ok(Math.abs(Number(titlePosition[2]) + fixture.bold.heightAtSize(18, { descender: false }) / 2 - 212) < .01);

  for (const warning of warnings) assert.equal(occurrences(page, hex(warning)), 1);
  assert.ok(fixture.page.node.Resources().lookup(PDFName.of('XObject'))); // Header/footer retained as clipped vector forms.
  assert.equal(fixture.document.getForm().getFields().length, 1); // Signature is free space, not a locked signature field.
});

test('comment persists offline after edit/save/reopen with native value, page widget and appearance, without PDF JS', async () => {
  const fixture = await pageFixture(); await add(fixture);
  let pdf = await PDFDocument.load(await fixture.document.save());
  const comment = 'NOTAM vérifiés :\nObservation après vol, modifiable.';
  pdf.getForm().getTextField(MOROCCO_NOTAM_FIELD).setText(comment);
  for (let i = 0; i < 2; i++) {
    pdf = await PDFDocument.load(await pdf.save());
    const field = pdf.getForm().getTextField(MOROCCO_NOTAM_FIELD), widget = field.acroField.getWidgets()[0];
    assert.equal(field.getText(), comment); assert.equal(field.isMultiline(), true); assert.equal(field.isReadOnly(), false);
    assert.equal(widget.P().toString(), pdf.getPage(6).ref.toString()); assert.ok(widget.getAppearances().normal);
    assert.equal(pdf.getPageCount(), 10); assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false);
    assert.equal(pdf.getForm().acroForm.dict.has(PDFName.of('CO')), false);
  }
});

test('different warnings retain their exact scope; similar wording is never merged', async () => {
  const fixture = await pageFixture(), data = blocks();
  data[0].warnings[0] = data[0].warnings[0].replace('incomplet.', 'manquant.');
  const grouped = moroccoNotamWarningGroups(data);
  assert.deepEqual(grouped.find(group => group.text === data[0].warnings[0]).indexes, [0]);
  assert.deepEqual(grouped.find(group => group.text === warnings[0]).indexes, [1, 2, 3]);
  assert.equal((await add(fixture, data)).added, true);
  const page = content(fixture.page);
  assert.equal(occurrences(page, hex(data[0].warnings[0])), 1);
  assert.equal(occurrences(page, hex(warnings[0])), 3);
  assert.equal(occurrences(page, hex(warnings[1])), 1);
  assert.ok(page.indexOf(hex(data[0].warnings[0])) < page.indexOf(hex(data[1].label)));
});

test('preflight keeps missing weather explicit and requests pagination for uncompressible content', async () => {
  const missing = await pageFixture(), data = blocks();
  data[0].tables = []; data[0].warnings = []; data[0].missing = ['Échéance indisponible.'];
  assert.equal((await add(missing, data)).added, true);
  assert.ok(content(missing.page).includes(hex('Échéance indisponible.')));
  const crowded = await pageFixture(), distinct = blocks(), original = content(crowded.page);
  distinct.forEach((block, index) => { block.warnings = block.warnings.map(warning => `${warning} Échéance ${index}.`); });
  assert.deepEqual(await add(crowded, distinct), { added: false });
  assert.equal(content(crowded.page), original); assert.equal(crowded.document.getPageCount(), 10);
  assert.equal(crowded.document.getForm().getFields().length, 0);
  const occupied = await pageFixture();
  assert.equal((await addMoroccoNotamPanel(occupied.document, occupied.page, occupied.font, occupied.bold, wrapDossierText, { bodyEndY: 54 })).added, false);
});

test('naturally free space accepts NOTAM without rewriting existing content or widgets', async () => {
  const fixture = await pageFixture();
  const existing = fixture.document.getForm().createTextField('charge-existing');
  existing.setText('1041'); existing.addToPage(fixture.page, { x: 42, y: 450, width: 120, height: 20 });
  const before = content(fixture.page);
  const result = await addMoroccoNotamPanel(fixture.document, fixture.page, fixture.font, fixture.bold, wrapDossierText, { bodyEndY: 400 });
  assert.equal(result.added, true); assert.ok(content(fixture.page).startsWith(before));
  const reopened = await PDFDocument.load(await fixture.document.save());
  assert.equal(reopened.getForm().getTextField('charge-existing').getText(), '1041');
  assert.equal(reopened.getPage(6).node.Annots().size(), 2); assert.equal(reopened.getPageCount(), 10);
});

function originalPagination() {
  const require = createRequire(import.meta.url);
  const js = ts.transpileModule(readFileSync(new URL('./moroccoFlightDossierPdf.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)(id => id === './moroccoNotamPdf.ts' ? { addMoroccoNotamPanel: async () => ({ added: true }) } : require(id), exports);
  return exports.createMoroccoFlightDossierPdf;
}
async function extendedWeather(count = 8) {
  const input = await dossierPdfFixture(), point = input.weather.altitudeWind.points[0];
  input.weather.window.expectedHours = Array.from({ length: count }, (_, i) => new Date(Date.parse('2026-11-05T00:00:00Z') + i * 3600000).toISOString());
  input.weather.altitudeWind.points = input.weather.window.expectedHours.map(validAt => ({ ...point, validAt, levels: point.levels.map(level => ({ ...level })), rejectedLevels: [
    { sourceLevel: '180 m AGL', reason: 'Vent proche du sol incomplet' }, { sourceLevel: '1000 hPa', reason: 'Niveau situé sous le terrain' },
    { sourceLevel: '975 hPa, 950 hPa, 900 hPa, 800 hPa', reason: 'Hauteur géopotentielle absente' },
  ] }));
  return input;
}

test('nominal generator keeps ten pages and the validated layout outside page 7', async () => {
  const input = await extendedWeather(); delete input.dossier.operations;
  const map = { error: 'Carte hors ligne' }, before = JSON.stringify(input);
  const baseline = await PDFDocument.load(await originalPagination()(input, map));
  const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, map));
  assert.equal(pdf.getPageCount(), 10); assert.equal(baseline.getPageCount(), 10);
  for (let i = 0; i < 10; i++) if (i !== 6) assert.equal(content(pdf.getPage(i)), content(baseline.getPage(i)), `page ${i + 1}`);
  assert.equal(pdf.getForm().getFields().filter(field => field.getName() === MOROCCO_NOTAM_FIELD).length, 1);
  assert.equal(JSON.stringify(input), before);
});

test('dense and incomplete weather always retain NOTAM, all existing fields, data, warnings and correct pagination', async t => {
  const baseline = originalPagination();
  let sawOverflow = false;
  for (const variant of ['ordinary', 'dense', 'different', 'missing', 'unavailable', 'long-taf']) {
    const input = variant === 'ordinary' ? await dossierPdfFixture() : await extendedWeather(variant === 'dense' ? 12 : 8);
    if (variant === 'dense') input.weather.altitudeWind.points.forEach((point, i) => {
      point.levels.forEach((level, j) => { level.sourceLevel = `Niveau-${i}-${j}`; });
      point.rejectedLevels.forEach((rejected, j) => { rejected.reason = `Avertissement distinct ${i}-${j}`; });
    });
    if (variant === 'different') input.weather.altitudeWind.points[4].rejectedLevels[0].reason = 'Vent proche du sol manquant';
    if (variant === 'missing') input.weather.altitudeWind.points.splice(4, 1);
    if (variant === 'unavailable') input.weather = null;
    if (variant === 'long-taf') for (const location of ['departure', 'landing']) input.weather.aviation[location].taf.result.data.tafRaw = 'TAF ' + 'DONNEE-METEO '.repeat(550) + 'FIN-MESSAGE';
    const map = { error: 'Carte hors ligne' }, before = JSON.stringify(input);
    const old = await PDFDocument.load(await baseline(input, map));
    const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, map));
    assert.ok(pdf.getPageCount() >= old.getPageCount(), variant);
    assert.ok(pdf.getPageCount() <= old.getPageCount() + 1, `${variant}: at most one overflow page`);
    sawOverflow ||= pdf.getPageCount() > old.getPageCount();
    t.diagnostic(`${variant}: ${old.getPageCount()} -> ${pdf.getPageCount()} pages`);
    for (const field of old.getForm().getFields()) {
      const current = pdf.getForm().getField(field.getName());
      assert.equal(current.isReadOnly(), field.isReadOnly());
      if ('getText' in field) assert.equal(current.getText(), field.getText(), field.getName());
      if ('getSelected' in field) assert.deepEqual(current.getSelected(), field.getSelected());
    }
    const form = pdf.getForm();
    assert.equal(form.getFields().filter(field => field instanceof PDFCheckBox).length, 39);
    assert.equal(pdf.getPage(1).node.Annots().size(), 29);
    assert.equal(form.getFields().filter(field => field.getName() === MOROCCO_NOTAM_FIELD).length, 1);
    const notam = form.getTextField(MOROCCO_NOTAM_FIELD), widget = notam.acroField.getWidgets()[0];
    assert.equal(widget.P().toString(), pdf.getPage(6).ref.toString());
    assert.deepEqual(widget.getRectangle(), { x: 48, y: 58, width: 243.64, height: 124 });
    for (const field of form.getFields()) if (field.getName() !== MOROCCO_NOTAM_FIELD) for (const other of field.acroField.getWidgets()) {
      if (other.P()?.toString() === pdf.getPage(6).ref.toString()) assert.ok(other.getRectangle().y >= 232, `${variant}: field outside NOTAM`);
    }
    const panelText = ['NOTAM', 'Commentaire', 'Signature'].map(hex);
    for (const match of content(pdf.getPage(6)).matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-F]+)> Tj/g)) {
      const y = Number(match[2]);
      if (y > 38 && !panelText.includes(match[3])) assert.ok(y >= 232, `${variant}: weather outside NOTAM (${y})`);
    }
    const all = pdf.getPages().map(content).join('\n');
    if (variant === 'dense') {
      for (const point of input.weather.altitudeWind.points) {
        for (const level of point.levels) assert.ok(all.includes(hex(level.sourceLevel)), level.sourceLevel);
        for (const rejected of point.rejectedLevels) assert.ok(all.includes(hex(rejected.reason)), rejected.reason);
      }
    }
    if (variant === 'long-taf') assert.ok(all.includes(hex('FIN-MESSAGE')));
    for (let i = 4; i < pdf.getPageCount(); i++) {
      assert.ok(contentWithForms(pdf.getPage(i)).includes(hex(`${i + 1} / ${pdf.getPageCount()}`)), `${variant}: page ${i + 1} numbering`);
    }
    notam.setText('Commentaire conservé après débordement.\nDeuxième ligne.');
    const reopened = await PDFDocument.load(await pdf.save());
    assert.equal(reopened.getForm().getTextField(MOROCCO_NOTAM_FIELD).getText(), 'Commentaire conservé après débordement.\nDeuxième ligne.');
    assert.equal(reopened.getPageCount(), pdf.getPageCount());
    assert.equal(JSON.stringify(input), before);
  }
  assert.ok(sawOverflow, 'at least one fixture exercises an additional weather page');
});

test('export downloads a complete PDF with NOTAM even when the old page 7 had insufficient free space', async () => {
  const input = await dossierPdfFixture(); let downloaded;
  await exportMoroccoFlightDossier(input, undefined, {
    renderMap: async () => ({ error: 'Carte hors ligne' }),
    createPdf: createMoroccoFlightDossierPdf,
    download(bytes) { downloaded = bytes; },
  });
  const pdf = await PDFDocument.load(downloaded);
  assert.ok(pdf.getForm().getTextField(MOROCCO_NOTAM_FIELD));
  assert.equal(pdf.getForm().getFields().filter(field => field instanceof PDFCheckBox).length, 39);
});

// A handwritten signature is a reader annotation, not an AcroForm /Sig (certificate).
const signatureRect = { x: 303.64, y: 58, width: 243.64, height: 124 };
const overlapsSignature = r => r.x < signatureRect.x + signatureRect.width && r.x + r.width > signatureRect.x
  && r.y < signatureRect.y + signatureRect.height && r.y + r.height > signatureRect.y;

test('generated NOTAM signature area has no encryption, certification, signature lock or intercepting widget', async () => {
  const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(await extendedWeather(), { error: 'Carte hors ligne' }));
  assert.equal(pdf.isEncrypted, false); assert.equal(pdf.context.trailerInfo.Encrypt, undefined);
  assert.equal(pdf.catalog.has(PDFName.of('Perms')), false);
  const page = pdf.getPage(6), form = pdf.getForm();
  assert.equal(form.acroForm.dict.has(PDFName.of('SigFlags')), false);
  assert.equal(form.getFields().filter(field => field.acroField.dict.get(PDFName.of('FT'))?.toString() === '/Sig').length, 0);
  for (const field of form.getFields()) {
    assert.equal(field.acroField.dict.has(PDFName.of('Lock')), false);
    for (const widget of field.acroField.getWidgets()) if (widget.P()?.toString() === page.ref.toString()) {
      assert.equal(overlapsSignature(widget.getRectangle()), false, field.getName());
    }
  }
});

test('standard handwritten Ink and imported-image Stamp survive two saves without losing editable fields or page layout', async () => {
  for (const subtype of ['Ink','Stamp']) {
    let pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(await extendedWeather(), { error: 'Carte hors ligne' }));
    // pdf-lib may add balanced graphics-state wrappers when an annotation is attached.
    const painting = page => content(page).split('\n').filter(line => !['', 'q', 'Q'].includes(line.trim())).join('\n');
    const beforePages = pdf.getPages().map(painting), pageCount = pdf.getPageCount();
    const fields = pdf.getForm().getFields().map(f => ({ name: f.getName(), readOnly: f.isReadOnly() }));
    const page = pdf.getPage(6), c = pdf.context;
    const normal = subtype === 'Ink'
      ? c.flateStream('q 0 0 0 RG 2 w 5 15 m 25 45 l 35 12 l 60 35 l 95 20 l 140 30 l S Q', { Type: 'XObject', Subtype: 'Form', BBox: [0,0,180,60] })
      : await (async () => {
        const image = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==','base64'));
        await image.embed();
        return c.flateStream('q 180 0 0 60 0 0 cm /SignatureImage Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0,0,180,60], Resources: { XObject: { SignatureImage: image.ref } } });
      })();
    const annotation = c.obj({ Type:'Annot', Subtype:subtype, Rect:[320,80,500,140], P:page.ref, F:4,
      AP:{N:c.register(normal)}, ...(subtype==='Ink'?{InkList:[[325,95,345,125,355,92,380,115,415,100,460,110]], C:[0,0,0], BS:{W:2}}:{Name:'Signature'}) });
    page.node.addAnnot(c.register(annotation));
    const comment='Commentaire NOTAM conservé avec annotation manuscrite.';
    pdf.getForm().getTextField(MOROCCO_NOTAM_FIELD).setText(comment);
    pdf.getForm().getCheckBox('avb-enveloppe-1').check();
    for(let i=0;i<2;i++) {
      pdf=await PDFDocument.load(await pdf.save());
      assert.equal(pdf.getPageCount(),pageCount); assert.deepEqual(pdf.getPages().map(painting),beforePages);
      for(const original of fields) assert.equal(pdf.getForm().getField(original.name).isReadOnly(),original.readOnly);
      assert.equal(pdf.getForm().getTextField(MOROCCO_NOTAM_FIELD).getText(),comment);
      assert.equal(pdf.getForm().getCheckBox('avb-enveloppe-1').isChecked(),true);
      const annots=pdf.getPage(6).node.Annots();
      const found=Array.from({length:annots.size()},(_,i)=>annots.lookup(i)).filter(a=>a.get(PDFName.of('Subtype'))?.toString()===`/${subtype}`);
      assert.equal(found.length,1);const a=found[0];
      assert.ok(a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')));
      if(subtype==='Ink')assert.ok(a.get(PDFName.of('InkList')));
      assert.equal(pdf.isEncrypted,false);
      assert.equal(pdf.getForm().getFields().length,fields.length);
    }
  }
});
