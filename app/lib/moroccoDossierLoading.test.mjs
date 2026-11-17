import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFCheckBox, PDFName } from 'pdf-lib';
import { calculateMoroccoLoading, applyMoroccoDossierLoading, MOROCCO_LOADING_DEFAULTS, readMoroccoPassengerDraft, saveMoroccoPassengerDraft, moroccoPassengerDraftKey } from './moroccoDossierLoading.ts';
import { emptyMoroccoPassengers } from './moroccoPassengers.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { createFlightDossierPdf } from './flightDossierPdf.ts';
import { exportMoroccoFlightDossier } from './moroccoFlightDossierExport.ts';

const row=(sex='H',weight)=>({lastName:'Nom',firstName:'Prénom',nationality:'Marocaine',sex,...(weight===undefined?{}:{customWeightKg:weight})});
const masses=(count=1)=>({...MOROCCO_LOADING_DEFAULTS,passengerCount:count});
async function fixture(){
 const base=await dossierPdfFixture();
 const loadInput=buildLoadCalculationInput({balloon:base.dossier.balloon,occupantsWeightKg:999,launchElevationMslM:47,plannedMaximumAltitudeMslM:1000,groundTemperature:base.dossier.operations.load.temperature});
 return {...base,passengers:[row('H',80),row('F',70)],loading:masses(2),loadInput};
}
test('60/5 defaults; add/remove/custom passenger, pilot and equipment weights are summed once',()=>{
 assert.deepEqual(MOROCCO_LOADING_DEFAULTS,{pilotKg:60,equipmentKg:5});
 assert.equal(calculateMoroccoLoading([row()],masses()).loadingKg,157);
 assert.equal(calculateMoroccoLoading([row(),row('F')],masses(2)).loadingKg,231);
 assert.equal(calculateMoroccoLoading([row('E',44)],{pilotKg:75,equipmentKg:8,passengerCount:1}).loadingKg,127);
 assert.equal(calculateMoroccoLoading([],masses(0)).loadingKg,65);
});
test('missing/invalid masses, partially entered rows and mismatched counts never become zero',()=>{
 for(const value of [NaN,Infinity,undefined,null,-1]){
  assert.throws(()=>calculateMoroccoLoading([row()],{...masses(),pilotKg:value}));
  assert.throws(()=>calculateMoroccoLoading([row()],{...masses(),equipmentKg:value}));
 }
 assert.throws(()=>calculateMoroccoLoading([row()],{...masses(),pilotKg:0}));
 assert.equal(calculateMoroccoLoading([row()],{...masses(),equipmentKg:0}).equipmentKg,0);
 for(const value of [NaN,null,0,-1])assert.throws(()=>calculateMoroccoLoading([row('H',value)],masses()));
 assert.throws(()=>calculateMoroccoLoading([row()],masses(2)),/nombre de passagers/);
 assert.throws(()=>calculateMoroccoLoading([row('')],masses(0)),/Passager 1/);
});
test('Morocco delegates the replacement total to the existing engine, preserves all other inputs and is idempotent',async()=>{
 const input=await fixture(),before=JSON.stringify(input),changed=applyMoroccoDossierLoading(input);
 const expected=calculateOfficialLoad({...input.loadInput,occupantsWeightKg:215});
 assert.equal(changed.dossier.operations.load.plannedMassKg,515); // 300 equipped + 150 pax + 60 pilot + 5 additional, not old 999.
 assert.equal(changed.dossier.operations.load.result.actualTotalMassKg,expected.actualTotalMassKg);
 assert.equal(changed.dossier.operations.load.marginKg,expected.marginKg);
 assert.equal(applyMoroccoDossierLoading(changed).dossier.operations.load.plannedMassKg,515);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(changed.dossier.operations.airspaces,input.dossier.operations.airspaces);
 const next=applyMoroccoDossierLoading({...input,loading:{pilotKg:75,equipmentKg:8,passengerCount:2}});
 assert.equal(next.dossier.operations.load.plannedMassKg,533);
 assert.throws(()=>applyMoroccoDossierLoading({...input,loadInput:undefined}),/Entrées du calcul/);
 assert.throws(()=>applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,balloonEquipmentWeightKg:undefined}}),/Masse du ballon équipé/);
 assert.throws(()=>applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,balloonEquipmentWeightKg:900}}),/incohérente/);
});
test('Morocco preserves altitude/demo guards and never promotes an unavailable manufacturer calculation',async()=>{
 const input=await fixture();
 const high=applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,plannedMaximumAltitudeMslM:100}});
 assert.equal(high.dossier.operations.load.unavailableReason,'TRACE_EXCEEDS_LOAD_ALTITUDE');assert.equal(high.dossier.operations.load.marginKg,null);
 const demo=structuredClone(input);demo.dossier.operations.load.unavailableReason='DEMO_DATA_EXCLUDED';
 const blocked=applyMoroccoDossierLoading(demo);assert.equal(blocked.dossier.operations.load.result,null);assert.equal(blocked.dossier.operations.load.marginKg,null);
 const unconfirmed=applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,configurationLimitsConfirmed:false}});
 assert.equal(unconfirmed.dossier.operations.load.status,'UNAVAILABLE');assert.equal(unconfirmed.dossier.operations.load.plannedMassKg,515);assert.equal(unconfirmed.dossier.operations.load.applicableLimitKg,null);
});
test('session navigation retains weights/reference and invalid drafts; keys isolate preparations and storage failure is explicit',()=>{
 const memory=new Map(),storage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)??null};
 const key=moroccoPassengerDraftKey('trace','balloon','2026-11-17');
 const rows=emptyMoroccoPassengers();rows[0]=row('H',81.5);
 const draft={rows,weightDrafts:{0:'81,5'},pilot:'72',equipment:'8',date:'2026-11-17',time:'08:00'};
 assert.equal(saveMoroccoPassengerDraft(key,draft,storage),true);
 assert.deepEqual(readMoroccoPassengerDraft(key,storage),draft);
 assert.equal(readMoroccoPassengerDraft(moroccoPassengerDraftKey('other','balloon','2026-11-17'),storage),null);
 draft.weightDrafts[0]='';draft.rows[0]={...draft.rows[0],customWeightKg:NaN};saveMoroccoPassengerDraft(key,draft,storage);
 assert.ok(Number.isNaN(readMoroccoPassengerDraft(key,storage).rows[0].customWeightKg));
 assert.equal(saveMoroccoPassengerDraft(key,draft,{setItem(){throw Error('quota');}}),false);
});
test('PDF/export use validated listing masses, retain editable fields/39 checkboxes and never add PDF calculations',async()=>{
 const input=await fixture();let exported;
 await exportMoroccoFlightDossier(input,undefined,{renderMap:async()=>({error:'offline'}),createPdf:async data=>{exported=data;return new Uint8Array();},download(){}});
 assert.equal(exported.dossier.operations.load.plannedMassKg,515);
 const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,{error:'offline'}));
 const form=pdf.getForm();
 for(const[name,value]of Object.entries({'charge-passagers':'150','charge-pilote':'60','charge-equipement':'5','charge-chargement-total':'215','charge-masse-prevue':'515','charge-occupants':'215'}))assert.equal(form.getTextField(name).getText(),value);
 assert.equal(form.getFields().filter(f=>f instanceof PDFCheckBox).length,39);
 assert.equal(form.acroForm.dict.has(PDFName.of('CO')),false);
 form.getTextField('charge-pilote').setText('85');
 const reopened=await PDFDocument.load(await pdf.save());assert.equal(reopened.getForm().getTextField('charge-pilote').getText(),'85');assert.equal(reopened.getForm().getTextField('charge-masse-prevue').getText(),'515');
 let rendered=false;
 await assert.rejects(exportMoroccoFlightDossier({...input,loading:{...input.loading,pilotKg:NaN}},undefined,{renderMap:async()=>{rendered=true;},createPdf(){},download(){}}),/Pilote/);
 assert.equal(rendered,false);
});
test('France retains original occupants/results and no Morocco loading fields',async()=>{
 const input=await fixture(),before=JSON.stringify(input.dossier.operations);
 applyMoroccoDossierLoading(input);
 assert.equal(JSON.stringify(input.dossier.operations),before);
 const france=await PDFDocument.load(await createFlightDossierPdf(input,{error:'offline'}));
 assert.equal(france.getForm().getFields().length,0);
});
