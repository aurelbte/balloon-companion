import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PDFDocument,PDFCheckBox,PDFDict,PDFHexString,PDFName,PDFTextField,decodePDFRawStream,StandardFonts} from 'pdf-lib';
import {moroccoFlightPlanBase64,MOROCCO_FLIGHT_PLAN_SHA256} from './moroccoFlightPlanAsset.ts';
import {insertMoroccoFlightPlan,moroccoFlightPlanPrefill,moroccoFlightPlanUtc,MOROCCO_FLIGHT_PLAN_FIELDS as names,MOROCCO_FLIGHT_PLAN_PREFIX as prefix} from './moroccoFlightPlanPdf.ts';
import {createMoroccoFlightDossierPdf} from './moroccoFlightDossierPdf.ts';
import {createFlightDossierPdf} from './flightDossierPdf.ts';
import {dossierPdfFixture} from './flightDossierPdf.fixtures.mjs';
const map={error:'Carte hors ligne'};
const content=page=>{
 const c=page.node.Contents();const streams=!c?[]:typeof c.size==='function'?Array.from({length:c.size()},(_,i)=>c.lookup(i)):[c];return streams.map(s=>Buffer.from(decodePDFRawStream(s).decode()).toString()).join('\n');
};
const require=createRequire(import.meta.url);
function withoutInsertion(){
 // Run the identical generator with insertion stubbed: verifies every pre-existing page and field.
 const js=ts.transpileModule(readFileSync(new URL('./moroccoFlightDossierPdf.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};new Function('require','exports',js)(id=>id==='./moroccoFlightPlanPdf.ts'?{insertMoroccoFlightPlan:async()=>{}}:require(id),exports);
 return exports.createMoroccoFlightDossierPdf;
}
const pax=sex=>({lastName:'Durand',firstName:'Alice',nationality:'Marocaine',sex});

test('embedded source matches supplied PDF, is A4/one page, and has exactly the 29 expected native editable fields',async()=>{
 const bytes=Buffer.from(moroccoFlightPlanBase64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),MOROCCO_FLIGHT_PLAN_SHA256);
 const supplied=await readFile(new URL('../../Plan_de_vol_Nomad_Ballooning CN-CBN.pdf',import.meta.url)).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
 if(supplied)assert.ok(bytes.equals(supplied));
 const source=await PDFDocument.load(bytes);assert.equal(source.getPageCount(),1);
 assert.ok(Math.abs(source.getPage(0).getWidth()-595.28)<.01);assert.ok(Math.abs(source.getPage(0).getHeight()-841.89)<.01);
 assert.deepEqual(source.getForm().getFields().map(f=>f.getName()).sort(),[...names].sort());
 assert.ok(source.getForm().getFields().every(f=>f instanceof PDFTextField&&!f.isReadOnly()));
});

test('insertion is directly after PAX; all old page streams, listing, checklist fields and curve remain unchanged',async()=>{
 const input=await dossierPdfFixture({kubicek:true});input.passengers=[pax('F')];
 // Existing synthetic rendering fixture, never a manufacturer validation or altered engine.
 Object.assign(input.dossier.operations.load,{status:'AVAILABLE',calculationStatus:'OFFICIAL_VALIDATED'});
 input.dossier.operations.load.curve.usedByCalculation=true;
 const before=JSON.stringify(input);
 const baseline=await PDFDocument.load(await withoutInsertion()(input,map));
 const merged=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 assert.equal(merged.getPageCount(),baseline.getPageCount()+1);
 assert.equal(content(merged.getPage(0)),content(baseline.getPage(0)));
 for(let i=1;i<baseline.getPageCount();i++)assert.equal(content(merged.getPage(i+1)),content(baseline.getPage(i)),`old page ${i+1}`);
 const source=await PDFDocument.load(moroccoFlightPlanBase64);
 assert.equal(content(merged.getPage(1)),content(source.getPage(0)));
 assert.equal(merged.getPage(1).node.Annots().size(),29);
 assert.equal(merged.getPage(2).node.Annots().size(),20);assert.equal(merged.getPage(3).node.Annots().size(),19);
 for(const f of baseline.getForm().getFields()){
  const next=merged.getForm().getField(f.getName());assert.equal(next.constructor.name,f.constructor.name);
  if(f instanceof PDFTextField)assert.equal(next.getText(),f.getText(),f.getName());
  if(f instanceof PDFCheckBox)assert.equal(next.isChecked(),f.isChecked(),f.getName());
 }
 assert.equal(merged.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length,39);
 assert.equal(merged.getForm().getFields().length,baseline.getForm().getFields().length+29);
 assert.ok(baseline.getPages().some(p=>content(p).includes(Buffer.from('Lift Units - points constructeur').toString('hex').toUpperCase())));
 assert.equal(JSON.stringify(input),before);
});

test('defaults use template values, actual known registration/pilot and UTC departure; P needs documented crew',async()=>{
 const input=await dossierPdfFixture();input.dossier.balloon.registration='';input.passengers=[pax('H'),pax('F')];
 const unknown=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 const text=name=>unknown.getForm().getTextField(prefix+name).getText()??'';
 assert.equal(text('7'),'CN-CBN');assert.equal(text('9t'),'Z-275');assert.equal(text('8a'),'VFR');assert.equal(text('8b'),'Commercial');
 assert.equal(text('13'),'BOURROUS');assert.equal(text('E'),'0100');assert.equal(text('P'),'');assert.equal(text('C'),'');
 assert.equal(text('13t'),'1000');assert.equal(text('16e'),'0100');assert.match(text('18'),/DOF\/261105/);
 input.flightPlanCrewOnBoardCount=2;input.pilotName='Élodie D’Ávila';input.dossier.balloon.registration='CN-ABC';
 const merged=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 assert.equal(merged.getForm().getTextField(prefix+'P').getText(),'4');assert.equal(merged.getForm().getTextField(prefix+'C').getText(),'Élodie D’Ávila');
 assert.equal(merged.getForm().getTextField(prefix+'7').getText(),'CN-ABC');assert.match(merged.getForm().getTextField(prefix+'18').getText(),/REG\/CNABC/);
 assert.equal(moroccoFlightPlanPrefill({...input,flightPlanCrewOnBoardCount:undefined,loading:{pilotKg:60,equipmentKg:5,passengerCount:2}}).P,'3');
 assert.throws(()=>moroccoFlightPlanPrefill({...input,flightPlanCrewOnBoardCount:0}),/équipage/);
});

test('UTC is derived only from a dated instant with an explicit offset, never from dossier reference or UTC +1',async()=>{
 assert.deepEqual(moroccoFlightPlanUtc('2026-11-05T00:30:00+01:00'),{time:'2330',date:'261104'});
 for(const invalid of ['UTC +1','08:00','2026-11-05T08:00:00','2026-02-30T08:00:00Z','2026-11-05T25:00:00Z',''])assert.equal(moroccoFlightPlanUtc(invalid),null);
 const input=await dossierPdfFixture();input.dossierReference={date:'2026-11-12',time:'08:15'};
 assert.equal(moroccoFlightPlanPrefill(input)['13t'],'1000'); // Actual scheduled departure, not weather-reference clock.
 input.dossier.startedAt='2026-11-05T08:00:00';
 const doc=await PDFDocument.create();doc.addPage();await insertMoroccoFlightPlan(doc,input);
 assert.equal(doc.getForm().getTextField(prefix+'13t').getText(),'');
});

test('all 29 fields remain editable/exported and correctly registered after repeated save, edit, reopen; no actions/JS',async()=>{
 const input=await dossierPdfFixture();input.pilotName='Élodie Martin';
 let pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 const drawings=pdf.getPages().map(content),form=pdf.getForm();
 for(const name of names){
  const field=form.getTextField(prefix+name);assert.equal(field.isReadOnly(),false);assert.equal(field.isExported(),true);
  assert.equal(field.acroField.getWidgets().length,1);
  assert.equal(field.acroField.getWidgets()[0].P().toString(),pdf.getPage(1).ref.toString());
  assert.equal(field.acroField.dict.lookup(PDFName.of('DV')).decodeText(),field.getText()??'');
  const widget=field.acroField.getWidgets()[0];assert.ok(widget.getAppearances().normal);assert.ok(widget.dict.has(PDFName.of('DA')));
  field.setText('Été — modifié');field.setFontSize(0);
 }
 form.getCheckBox('avb-enveloppe-1').check();form.getTextField('pax-1-nom').setText('PAX conservé');
 pdf=await PDFDocument.load(await pdf.save());
 for(const name of names){const field=pdf.getForm().getTextField(prefix+name);assert.equal(field.getText(),'Été — modifié');assert.equal(field.isReadOnly(),false);}
 assert.equal(pdf.getForm().getTextField('pax-1-nom').getText(),'PAX conservé');assert.equal(pdf.getForm().getCheckBox('avb-enveloppe-1').isChecked(),true);
 assert.deepEqual(pdf.getPages().map(content),drawings);
 pdf=await PDFDocument.load(await pdf.save());assert.equal(pdf.getForm().getTextField(prefix+'P').getText(),'Été — modifié');
 assert.equal(pdf.catalog.has(PDFName.of('OpenAction')),false);assert.equal(pdf.getForm().acroForm.dict.has(PDFName.of('CO')),false);
 for(const [,object]of pdf.context.enumerateIndirectObjects())if(object instanceof PDFDict)for(const key of ['JS','JavaScript','AA'])assert.equal(object.has(PDFName.of(key)),false,key);
});

test('field/font collisions are guarded and non-WinAnsi pilot text stays canonical without blocking export',async()=>{
 const input=await dossierPdfFixture(),doc=await PDFDocument.create();doc.addPage();
 const font=await doc.embedFont(StandardFonts.Courier);
 const dr=doc.context.obj({Font:{Helv:font.ref}});doc.getForm().acroForm.dict.set(PDFName.of('DR'),dr);
 await insertMoroccoFlightPlan(doc,{...input,pilotName:'أمين'});
 assert.equal(doc.getForm().getTextField(prefix+'C').getText(),'أمين');
 assert.equal(dr.lookup(PDFName.of('Font'),PDFDict).get(PDFName.of('Helv')).toString(),font.ref.toString());
 const reopened=await PDFDocument.load(await doc.save());assert.equal(reopened.getForm().getTextField(prefix+'C').getText(),'أمين');
 await assert.rejects(insertMoroccoFlightPlan(doc,input),/Collision/);
 const fr=await PDFDocument.load(await createFlightDossierPdf(input,map));assert.equal(fr.getForm().getFields().length,0);
});
