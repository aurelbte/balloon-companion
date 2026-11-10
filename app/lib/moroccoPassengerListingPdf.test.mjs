import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFCheckBox,decodePDFRawStream} from 'pdf-lib';
import {createMoroccoFlightDossierPdf} from './moroccoFlightDossierPdf.ts';
import {moroccoPassengerListingBase64} from './moroccoPassengerListingAsset.ts';
import {moroccoChecklistBase64} from './moroccoChecklistAsset.ts';
import {dossierPdfFixture} from './flightDossierPdf.fixtures.mjs';
import {emptyMoroccoPassengers} from './moroccoPassengers.ts';
const map={error:'Hors ligne'};
const contents=page=>{
  const c=page.node.Contents();const a=typeof c.size==='function'?Array.from({length:c.size()},(_,i)=>c.lookup(i)):[c];
  return a.map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString()).join('\n');
};
function passengers(){const p=emptyMoroccoPassengers();for(const [i,sex] of ['H','F','E'].entries())p[i]={lastName:['Dupont','D’Artagnan','Petit'][i],firstName:['Jean','Éléonore','Léo'][i],nationality:'Française',sex};return p;}

test('original logo, table, MANEX and exact PDF page precede both original AVB checklist pages',async()=>{
  const input=await dossierPdfFixture();const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,passengers:passengers()},map));
  const source=await PDFDocument.load(moroccoPassengerListingBase64),checklist=await PDFDocument.load(moroccoChecklistBase64);
  assert.deepEqual(pdf.getPage(0).getMediaBox(),source.getPage(0).getMediaBox());
  assert.equal(pdf.getPage(0).node.has(PDFName.of('StructParents')),false); // Prevent PDFKit tag-tree collisions on merge.
  assert.ok(contents(pdf.getPage(0)).includes(contents(source.getPage(0))));
  assert.ok(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject')));
  for(let i=0;i<2;i++)assert.ok(contents(pdf.getPage(i+1)).includes(contents(checklist.getPage(i))));
  const form=pdf.getForm();assert.equal(form.getFields().length,106);assert.equal(form.getFields().filter(f=>f instanceof PDFCheckBox).length,39);
  assert.equal(pdf.getPage(0).node.Annots().size(),67);
  for(const field of form.getFields().filter(f=>f.getName().startsWith('pax-'))){assert.equal(field.isReadOnly(),false);assert.equal(field.acroField.getWidgets()[0].P().toString(),pdf.getPage(0).ref.toString());assert.ok(field.acroField.getWidgets()[0].getAppearances().normal);assert.ok(field.acroField.getWidgets()[0].dict.has(PDFName.of('DA')));assert.equal(field.acroField.dict.has(PDFName.of('AA')),false);}
  assert.equal(pdf.catalog.has(PDFName.of('OpenAction')),false);
  const names=pdf.catalog.lookupMaybe(PDFName.of('Names'));assert.ok(!names?.has(PDFName.of('JavaScript')));
});

test('date uses dossier launch timezone, three weights are precomputed, blank places remain blank and PDF reopens offline',async()=>{
  const input={...await dossierPdfFixture(),passengers:passengers()};input.dossier.startedAt='2026-11-05T23:30:00Z';input.dossier.launchTimeZone='Africa/Casablanca';
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));const form=pdf.getForm();
  assert.equal(form.getTextField('pax-date').getText(),'06/11/2026');
  for(const [i,value] of ['92 kg','74 kg','35 kg'].entries())assert.equal(form.getTextField(`pax-${i+1}-poids`).getText(),value);
  assert.equal(form.getTextField('pax-2-prenom').getText(),'Éléonore');assert.equal(form.getTextField('pax-1-nationalite').isMultiline(),true);assert.equal(form.getTextField('pax-13-poids').getText(),undefined);
  const sex=form.getDropdown('pax-1-sexe');assert.deepEqual(sex.getOptions(),['','H','F','E']);assert.equal(sex.isEditable(),false);
  sex.select('E');form.getTextField('pax-1-poids').setText('35 kg');form.getTextField('pax-1-nom').setText('Modifié');
  const reopened=await PDFDocument.load(await pdf.save());assert.deepEqual(reopened.getForm().getDropdown('pax-1-sexe').getSelected(),['E']);assert.equal(reopened.getForm().getTextField('pax-1-poids').getText(),'35 kg');assert.equal(reopened.getForm().getTextField('pax-1-nom').getText(),'Modifié');
});

test('passenger input changes only page one, leaving every following page drawing unchanged',async()=>{
  const input={...await dossierPdfFixture(),generatedAt:'2026-11-10T06:00:00Z'};
  const blank=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));const filled=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,passengers:passengers()},map));
  assert.equal(blank.getPageCount(),filled.getPageCount());
  for(let i=1;i<blank.getPageCount();i++)assert.equal(contents(blank.getPage(i)),contents(filled.getPage(i)),`page ${i+1}`);
});

test('personal weight reaches the PDF and remains editable and unchanged when sex changes offline',async()=>{
  const input={...await dossierPdfFixture(),passengers:[{lastName:'Nom',firstName:'Prénom',nationality:'Marocaine',sex:'F',customWeightKg:81.5}]};
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));const form=pdf.getForm();
  const weight=form.getTextField('pax-1-poids');assert.equal(weight.getText(),'81,5 kg');assert.equal(weight.isReadOnly(),false);
  form.getDropdown('pax-1-sexe').select('E');let reopened=await PDFDocument.load(await pdf.save());assert.equal(reopened.getForm().getTextField('pax-1-poids').getText(),'81,5 kg');
  reopened.getForm().getTextField('pax-1-poids').setText('77,2 kg');reopened.getForm().getDropdown('pax-1-sexe').select('H');
  reopened=await PDFDocument.load(await reopened.save());assert.equal(reopened.getForm().getTextField('pax-1-poids').getText(),'77,2 kg');
});
