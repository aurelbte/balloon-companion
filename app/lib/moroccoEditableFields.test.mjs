import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFCheckBox, decodePDFRawStream } from 'pdf-lib';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { createFlightDossierPdf } from './flightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
const map={error:'Carte hors ligne'};
const content=page=>{
 const c=page.node.Contents();return Array.from({length:c.size()},(_,i)=>Buffer.from(decodePDFRawStream(c.lookup(i)).decode()).toString()).join('\n');
};
async function fixture(){
 const input=await dossierPdfFixture({kubicek:true});
 // Synthetic available/validated result exercises rendering only; no engine or constructor validation is changed.
 const load=input.dossier.operations.load;
 Object.assign(load,{status:'AVAILABLE',calculationStatus:'OFFICIAL_VALIDATED',applicableLimitKg:800,marginKg:300,signedMarginKg:'+300 kg',limitingRule:'PERFORMANCE',result:{status:'AVAILABLE',datasetId:'test-render-only',manualRevision:'TEST',calculatedAt:'2026-11-05T08:00:00Z',maximumAltitudeMslM:1000,groundTemperatureC:10,groundTemperatureSource:'arome_seamless'}});
 load.curve.usedByCalculation=true;
 return {...input,pilotName:'Élodie Martin',observations:'Contrôle initial effectué.',passengers:[{lastName:'Durand',firstName:'Alice',nationality:'Française',sex:'F',customWeightKg:81.5}]};
}
test('Morocco operational values are prefilled editable fields, with preserved appearances and native defaults',async()=>{
 const input=await fixture(),before=JSON.stringify(input);const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 const form=pdf.getForm();
 const expected={'vol-pilote':'Élodie Martin','vol-terrain':input.dossier.launchSiteName,'vol-ballon':'F-TEST - Kubícek BB26','vol-passagers-nombre':'1','charge-temperature':'10','charge-masse-prevue':'500','charge-limite':'800','charge-marge':'+300 kg','charge-altitude-maximale':'1 000','charge-temperature-resultat':'10','charge-ballon-equipe':'300','charge-occupants':'200','charge-mtom':'952','vol-observations':'Contrôle initial effectué.'};
 for(const [name,value]of Object.entries(expected)){
  const field=form.getTextField(name);assert.equal(field.getText(),value,name);assert.equal(field.isReadOnly(),false);assert.equal(field.isExported(),true);assert.equal(field.acroField.dict.get(PDFName.of('DV')).decodeText(),value);
  for(const widget of field.acroField.getWidgets()){
   assert.ok(widget.getAppearances().normal);assert.ok(widget.dict.has(PDFName.of('DA')));
   const page=pdf.getPages().find(p=>p.ref.toString()===widget.P().toString());assert.ok(page);
   const r=widget.getRectangle();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=page.getWidth()+.1&&r.y+r.height<=page.getHeight()+.1,name);
  }
 }
 assert.equal(JSON.stringify(input),before);
 assert.equal(form.getFields().filter(f=>f instanceof PDFCheckBox).length,39);
 assert.equal(form.getTextField('vol-observations').isMultiline(),true);
 assert.equal(pdf.getPage(0).node.Annots().size(),67);
});
test('offline edit/save/reopen preserves every manual correction independently, without recalculation or changing protected page content',async()=>{
 const input=await fixture();const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 const drawings=pdf.getPages().map(content);const fields=pdf.getForm();
 const edits={'vol-pilote':'Pilote corrigé','vol-ballon':'CN-TEST / équipement réel','vol-decollage':'06/11/2026 09:15','vol-atterrissage':'06/11/2026 10:30','vol-duree':'75 min','vol-reference':'06/11/2026 09:00','vol-passagers-nombre':'2','charge-masse-prevue':'640','charge-temperature':'25','charge-limite':'750','charge-marge':'110 kg','charge-altitude-maximale':'900','charge-ballon-equipe':'320','charge-occupants':'320','charge-mtom':'850','vol-observations':'Après vol :\nCorrections manuelles indépendantes.','pax-1-nom':'Corrigé','pax-1-prenom':'Prénom','pax-1-poids':'77,2 kg'};
 for(const [name,value]of Object.entries(edits))fields.getTextField(name).setText(value);
 fields.getDropdown('pax-1-sexe').select('H');fields.getCheckBox('avb-enveloppe-1').check();
 const reopened=await PDFDocument.load(await pdf.save());
 for(const [name,value]of Object.entries(edits))assert.equal(reopened.getForm().getTextField(name).getText(),value,name);
 // Another temperature/result and default weights are not recalculated from edited inputs.
 assert.equal(reopened.getForm().getTextField('charge-temperature-resultat').getText(),'10');
 assert.equal(reopened.getForm().getTextField('charge-marge').getText(),'110 kg');
 assert.equal(reopened.getForm().getTextField('pax-1-poids').getText(),'77,2 kg');
 assert.equal(reopened.getForm().getCheckBox('avb-enveloppe-1').isChecked(),true);
 assert.deepEqual(reopened.getPages().map(content),drawings); // Includes METAR/TAF, forecast tables, source references, curve paths and map.
 const again=await PDFDocument.load(await reopened.save());assert.equal(again.getForm().getTextField('vol-observations').getText(),edits['vol-observations']);
});
test('no PDF JavaScript, actions, calculation order or editable weather/trajectory/reference widgets; curve has no widget over it',async()=>{
 const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(await fixture(),map));
 assert.equal(pdf.catalog.has(PDFName.of('OpenAction')),false);assert.equal(pdf.getForm().acroForm.dict.has(PDFName.of('CO')),false);
 for(const [,object]of pdf.context.enumerateIndirectObjects())if(object instanceof PDFDict){
  for(const key of ['JS','JavaScript','AA'])assert.equal(object.has(PDFName.of(key)),false,key);
 }
 for(const f of pdf.getForm().getFields())assert.match(f.getName(),/^(avb-|pax-|vol-|charge-)/);
 const graphic=pdf.getPages().find(p=>content(p).includes(Buffer.from('Lift Units - points constructeur').toString('hex').toUpperCase()));assert.ok(graphic,'source curve retained');
 for(const ref of graphic.node.Annots()?.asArray() ?? []){const widget=pdf.context.lookup(ref);const r=widget.lookup(PDFName.of('Rect'));assert.ok(r.get(3).asNumber()<500,'no field covers the graph, axes or legend');}
 // The graph and its source are page drawing instructions, not text fields.
 assert.ok(pdf.getForm().getFields().every(f=>!/(metar|taf|vent|weather|trace|source|courbe|dataset|revision)/i.test(f.getName())));
});
test('missing pilot and load stay blank/unavailable but can be completed manually; France remains a static PDF',async()=>{
 const input=await dossierPdfFixture();delete input.dossier.operations;
 const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,map));
 assert.equal(pdf.getForm().getTextField('vol-pilote').getText(),undefined);
 for(const name of ['charge-temperature','charge-masse-prevue','charge-limite','charge-marge'])assert.equal(pdf.getForm().getTextField(name).getText(),'indisponible');
 const fr=await PDFDocument.load(await createFlightDossierPdf(input,map));assert.equal(fr.getForm().getFields().length,0);
});
