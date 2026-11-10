import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { createFlightDossierPdf } from './flightDossierPdf.ts';
import { exportMoroccoFlightDossier } from './moroccoFlightDossierExport.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { resolveMoroccoDossierReference } from './moroccoDossierReference.ts';
import { dossierLocalTime } from './flightDossierPresentation.ts';
const map={error:'Carte hors ligne'};
const contents=page=>{const s=page.node.Contents();return Array.from({length:s.size()},(_,i)=>Buffer.from(decodePDFRawStream(s.lookup(i)).decode()).toString()).join('\n');};
const has=(page,text)=>contents(page).includes(Buffer.from(text,'latin1').toString('hex').toUpperCase());
const allHas=(pdf,text)=>pdf.getPages().some(p=>has(p,text));
const reference={date:'2026-11-12',time:'08:15'};

test('chosen dossier clock appears on listing, both checklists, every preparation page and metadata; no wall-clock generation date',async()=>{
  const input={...await dossierPdfFixture(),dossierReference:reference,generatedAt:'2099-01-01T12:34:00Z'};const before=JSON.stringify(input);
  const resolved=resolveMoroccoDossierReference(input.dossier,reference);
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map),{updateMetadata:false});
  assert.equal(pdf.getForm().getTextField('pax-date').getText(),'12/11/2026');assert.equal(pdf.getForm().getTextField('pax-heure').getText(),'08:15');
  assert.equal(pdf.catalog.has(PDFName.of('Metadata')),false);assert.match(pdf.getTitle(),/12\/11\/2026 08:15/);assert.equal(pdf.getCreationDate().toISOString(),resolved.iso);assert.equal(pdf.getModificationDate().toISOString(),resolved.iso);
  for(let i=1;i<pdf.getPageCount();i++)assert.ok(has(pdf.getPage(i),i<3?`Dossier : ${resolved.label}`:resolved.label),`page ${i+1}`);
  assert.equal(allHas(pdf,'Généré le'),false);assert.equal(allHas(pdf,'2099'),false);
  assert.equal(JSON.stringify(input),before);
});

test('flight events, meteorological validity and METAR emission/retrieval retain their actual source timestamps',async()=>{
  const input={...await dossierPdfFixture(),dossierReference:reference};const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
  const issued=input.weather.aviation.departure.metar.result.data.metarIssuedAt;
  const fetched=input.weather.aviation.departure.metar.result.data.sourceUpdatedAt;
  // Wrapping may split a long line, so check exact local date/time tokens, not the generated layout.
  const prefix=iso=>dossierLocalTime(iso,input.dossier.launchTimeZone,true).split(' (')[0];
  assert.ok(allHas(pdf,prefix(input.dossier.startedAt)));assert.ok(allHas(pdf,prefix(input.dossier.landingAt)));
  assert.ok(allHas(pdf,`Émis : ${prefix(issued)}`));assert.ok(allHas(pdf,`Récupéré : ${prefix(fetched)}`));
  assert.ok(allHas(pdf,'LFQQ 050800Z 24006KT 9999 SCT030 11/08 Q1022'));
  assert.ok(allHas(pdf,prefix(input.weather.window.expectedHours[0])));
});

test('export uses the chosen local reference date in its filename and does not replace source dossier/weather',async()=>{
  const input={...await dossierPdfFixture(),dossierReference:reference};let filename;
  await exportMoroccoFlightDossier(input,undefined,{renderMap:async points=>{assert.equal(points,input.dossier.points);return map;},createPdf:async received=>{assert.equal(received.dossier,input.dossier);assert.equal(received.weather,input.weather);assert.deepEqual(received.dossierReference,reference);return new Uint8Array([1]);},download:(_,name)=>{filename=name;}});
  assert.match(filename,/^preparation-maroc_2026-11-12_/);
  await assert.rejects(exportMoroccoFlightDossier({...input,dossierReference:{date:'2026-02-30',time:'08:15'}},undefined,{renderMap:async()=>{throw Error('must not run');},createPdf:async()=>new Uint8Array(),download(){}}),/Date\/heure/);
});

test('France generator ignores the Morocco document reference and preserves its existing pages',async()=>{
  const input=await dossierPdfFixture();const baseline=await PDFDocument.load(await createFlightDossierPdf(input,map));const withReference=await PDFDocument.load(await createFlightDossierPdf({...input,dossierReference:reference},map));
  assert.equal(baseline.getPageCount(),withReference.getPageCount());assert.equal(baseline.getTitle(),withReference.getTitle());
  for(let i=0;i<baseline.getPageCount();i++)assert.equal(contents(baseline.getPage(i)),contents(withReference.getPage(i)));
});
