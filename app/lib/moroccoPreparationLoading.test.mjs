import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PDFDocument, PDFCheckBox, decodePDFRawStream } from 'pdf-lib';
import * as loadingModule from './moroccoDossierLoading.ts';
import * as passengersModule from './moroccoPassengers.ts';
import * as referenceModule from './moroccoDossierReference.ts';
import * as minimumModule from './moroccoMinimumLandingMass.ts';
import { MOROCCO_LANDING_MASS_RULES } from './moroccoMinimumLandingMassData.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';

async function fixture() {
  const input = await dossierPdfFixture();
  input.dossier.balloon.weights.fullCylinders = [{ id:'tank', label:'Pesée complète propane inclus', fullWeightKg:150 }];
  input.loadInput = buildLoadCalculationInput({ balloon:input.dossier.balloon, occupantsWeightKg:999, launchElevationMslM:47,
    plannedMaximumAltitudeMslM:1000, groundTemperature:input.dossier.operations.load.temperature });
  input.passengers=[{lastName:'Nom',firstName:'Prénom',nationality:'Marocaine',sex:'H',customWeightKg:80}];
  input.loading={pilotKg:60,equipmentKg:5,passengerCount:1,expectedGasConsumptionKg:70,
    fuel:{propaneOnBoardKg:100,fullCylinderMassesConfirmed:true,configurationKey:minimumModule.moroccoLandingMassConfigurationKey(input.dossier.balloon)}};
  return input;
}

test('AMSL is unchanged; explicit AGL converts once using known terrain, never assumes an altitude or datum',()=>{
  assert.equal(loadingModule.moroccoProjectedAltitudeAmsl('1000','AMSL',300),1000);
  assert.equal(loadingModule.moroccoProjectedAltitudeAmsl('1000','AGL',300),1300);
  assert.equal(loadingModule.moroccoProjectedAltitudeAmsl('1000,5','AMSL',300),1000.5);
  assert.throws(()=>loadingModule.moroccoProjectedAltitudeAmsl('1000','AGL'),/terrain absente/);
  assert.throws(()=>loadingModule.moroccoProjectedAltitudeAmsl('1000','UNKNOWN',300),/inconnu/);
  for(const value of ['', '-1', 'NaN', '200']) assert.throws(()=>loadingModule.moroccoProjectedAltitudeAmsl(value,'AMSL',300));
});

test('70 kg is an aircraft-specific pilot estimate, never a Z275 manufacturer default',async()=>{
  const {dossier}=await fixture();const b={...dossier.balloon,registration:'CN-CBN',model:'Z-275'};
  assert.equal(loadingModule.moroccoDefaultGasConsumption(b),70);
  for(const patch of [{registration:'CN-OTHER'},{model:'Z105'},{manufacturer:'Ultramagic'}]) assert.equal(loadingModule.moroccoDefaultGasConsumption({...b,...patch}),undefined);
});

test('one takeoff total, confirmed fuel subtraction, unknown MLM and changed/absent fuel remain explicit',async()=>{
  const input=await fixture(), prepared=loadingModule.applyMoroccoDossierLoading(input);
  assert.equal(prepared.dossier.operations.load.plannedMassKg,595); // 300 equipment + 150 full tank + 80 PAX + 60 + 5; no extra 100 propane.
  const landing=loadingModule.calculateMoroccoLandingMass(prepared);
  assert.equal(landing.landingKg,525);assert.equal(landing.minimum.kg,null);assert.equal(landing.marginKg,null);
  assert.equal(loadingModule.applyMoroccoDossierLoading(prepared).dossier.operations.load.plannedMassKg,595);
  for(const change of [v=>delete v.loading.fuel, v=>v.loading.fuel.fullCylinderMassesConfirmed=false,
    v=>v.loading.fuel.configurationKey='different',v=>delete v.loading.expectedGasConsumptionKg,
    v=>v.loading.fuel.propaneOnBoardKg=151]) {
    const v=structuredClone(prepared);change(v);assert.equal(loadingModule.calculateMoroccoLandingMass(v).landingKg,null);
  }
  for(const gas of [-1,NaN,Infinity,101]) assert.throws(()=>loadingModule.applyMoroccoDossierLoading({...input,loading:{...input.loading,expectedGasConsumptionKg:gas}}));
  assert.throws(()=>loadingModule.applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,balloonId:'another'}}),/changé/);
});

test('canonical altitude drives the existing constructor calculation and guard without touching archived points/weather',async()=>{
  const input=await fixture(), before=structuredClone(input);
  const first=loadingModule.applyMoroccoDossierLoading(input);
  const second=loadingModule.applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,plannedMaximumAltitudeMslM:1500}});
  assert.equal(second.dossier.operations.load.result.maximumAltitudeMslM,1500);
  assert.notEqual(second.dossier.operations.load.applicableLimitKg,first.dossier.operations.load.applicableLimitKg);
  assert.deepEqual(second.dossier.points,input.dossier.points);assert.deepEqual(second.weather,input.weather);
  assert.deepEqual(input,before);
  const tooLow=loadingModule.applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,plannedMaximumAltitudeMslM:300}});
  assert.equal(tooLow.dossier.operations.load.unavailableReason,'TRACE_EXCEEDS_LOAD_ALTITUDE');
});

// Execute the real dialog handlers with persistent hooks and session storage, without browser/network dependencies.
function harness(props) {
  const slots=[];let cursor=0,effects=[];
  const react={useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(v){const i=cursor++;return slots[i]??(slots[i]={current:v});},useId(){return 'dialog-title';},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old[j])){slots[i]=deps;effects.push(fn);}}};
  const jsx=(type,props)=>({type,props});
  const mocks={'react':react,'react-dom':{createPortal:v=>v},'react/jsx-runtime':{jsx,jsxs:jsx},
    '../lib/moroccoDossierReference':referenceModule,'../lib/moroccoPassengers':passengersModule,'../lib/moroccoDossierLoading':loadingModule,'../lib/moroccoMinimumLandingMass':minimumModule};
  const js=ts.transpileModule(readFileSync(new URL('../components/MoroccoPassengerDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',js)(id=>{assert.ok(id in mocks,id);return mocks[id];},exports);
  return ()=>{cursor=0;effects=[];const tree=exports.default(props);effects.forEach(fn=>fn());return tree;};
}
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];}
const field=(tree,label)=>nodes(tree).find(n=>n.props?.['aria-label']===label);

test('real dialog uses canonical altitude on opening/edit/reopening, retains pilot gas entry and blocks invalid altitude',async()=>{
  const input=await fixture();input.dossier.balloon.registration='CN-CBN';input.dossier.balloon.model='Z275';input.dossier.balloon.volumeM3=7788;
  input.loadInput={...input.loadInput,model:'Z275',volumeM3:7788};
  const memory=new Map(), previousStorage=globalThis.sessionStorage, previousDocument=globalThis.document;
  globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)??null};globalThis.document={body:{}};
  try {
    let canonical=1000,exported=0;
    const props={dossier:input.dossier,loadInput:input.loadInput,draftKey:'real-dialog-test',reference:referenceModule.resolveMoroccoDossierReference(input.dossier),
      onAltitudeChange:value=>{canonical=value;props.loadInput={...props.loadInput,plannedMaximumAltitudeMslM:value};},onCancel(){},onExport(){exported++;}};
    let render=harness(props),tree=render();
    assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1000');
    assert.equal(field(tree,'Gaz consommé prévu (kg)').props.value,'70');
    field(tree,'Gaz consommé prévu (kg)').props.onChange({target:{value:'61'}});tree=render();
    field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:'1500'}});tree=render();assert.equal(canonical,1000);
    field(tree,'Altitude de vol projetée (m AMSL)').props.onBlur();tree=render();assert.equal(canonical,1500);
    assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    render=harness(props);tree=render();assert.equal(field(tree,'Gaz consommé prévu (kg)').props.value,'61');assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:''}});tree=render();
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported,0);assert.equal(canonical,1500);
    render=harness(props);tree=render();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported,1);
    field(tree,'Propane embarqué (kg)').props.onChange({target:{value:'100'}});tree=render();
    nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=render();
    props.dossier={...props.dossier,balloon:{...props.dossier.balloon,weights:{...props.dossier.balloon.weights,basketKg:151}}};
    props.loadInput={...props.loadInput,balloonEquipmentWeightKg:451};
    render=harness(props);tree=render();
    assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false);
    assert.equal(field(tree,'Gaz consommé prévu (kg)').props.value,'61');
    assert.equal(field(tree,'Propane embarqué (kg)').props.value,'100');
  } finally {globalThis.sessionStorage=previousStorage;globalThis.document=previousDocument;}
});

test('real dialog preserves each decimal keystroke and normalizes only on blur or export, with invalid input blocked',async()=>{
  const input=await fixture(),memory=new Map(),previousStorage=globalThis.sessionStorage,previousDocument=globalThis.document;
  globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)??null};globalThis.document={body:{}};
  try {
    let canonical=1000,exported;
    const props={dossier:input.dossier,loadInput:input.loadInput,draftKey:'decimal-edit',reference:referenceModule.resolveMoroccoDossierReference(input.dossier),
      onAltitudeChange(value){canonical=value;props.loadInput={...props.loadInput,plannedMaximumAltitudeMslM:value};},onCancel(){},onExport(...args){exported=args;}};
    for(const text of ['1000.5','1000,5']) {
      canonical=1000;props.loadInput={...props.loadInput,plannedMaximumAltitudeMslM:1000};
      let render=harness(props),tree=render();
      field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:''}});tree=render();
      let typed='';
      for(const character of text) {
        typed+=character;
        field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:typed}});tree=render();
        assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,typed);
        assert.equal(canonical,1000,'draft must not overwrite canonical altitude');
      }
      field(tree,'Altitude de vol projetée (m AMSL)').props.onBlur();tree=render();
      assert.equal(canonical,1000.5);assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1000.5');
      render=harness(props);tree=render();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1000.5');
      for(const value of ['','-1','1e3','NaN','1000..5','1000,5.2','30']) {
        exported=undefined;field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value}});tree=render();
        field(tree,'Altitude de vol projetée (m AMSL)').props.onBlur();tree=render();
        nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
        assert.equal(exported,undefined);assert.equal(canonical,1000.5);
      }
      field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:'1500,25'}});tree=render();
      nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
      assert.equal(canonical,1500.25);assert.equal(exported[4],1500.25,'submit carries the validated altitude before React rerender');
    }
  } finally {globalThis.sessionStorage=previousStorage;globalThis.document=previousDocument;}
});

test('dialog MLM review is explicit, persists and reaches PDF; edition, configuration and documentary drift revoke it',async()=>{
  const input=await fixture();Object.assign(input.dossier.balloon,{model:'Z275',volumeM3:7788});input.loadInput={...input.loadInput,model:'Z275',volumeM3:7788};
  const rules=minimumModule.moroccoLandingMassRulesForBalloon(input.dossier.balloon);
  const memory=new Map(),previousStorage=globalThis.sessionStorage,previousDocument=globalThis.document;
  globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)??null};globalThis.document={body:{}};
  try {
    let exported;
    const props={dossier:input.dossier,loadInput:input.loadInput,draftKey:'mlm-review',reference:referenceModule.resolveMoroccoDossierReference(input.dossier),onCancel(){},onExport(...args){exported=args;}};
    let render=harness(props),tree=render();
    assert.equal(field(tree,'Édition du manuel MLM').props.value,'');assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,false);
    field(tree,'Édition du manuel MLM').props.onChange({target:{value:rules[0].source.sha256}});tree=render();
    assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.disabled,true);
    field(tree,'Référence de configuration MLM').props.onChange({target:{value:'Revue de test page i-i / suppléments, non opérationnelle'}});tree=render();
    assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,false);
    field(tree,'Confirmer l’applicabilité MLM').props.onChange({target:{checked:true}});tree=render();
    assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,true);
    render=harness(props);tree=render();assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,true);
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(minimumModule.moroccoMinimumLandingMass(props.dossier.balloon,exported[3]).kg,1247);
    const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,passengers:exported[0],loading:exported[2],minimumLandingMassApplicability:exported[3]},{error:'offline'}));
    assert.equal(pdf.getForm().getTextField('charge-masse-minimale-atterrissage').getText(),'1 247');
    field(tree,'Édition du manuel MLM').props.onChange({target:{value:rules[1].source.sha256}});tree=render();
    assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,false);
    field(tree,'Confirmer l’applicabilité MLM').props.onChange({target:{checked:true}});tree=render();
    const saved=JSON.parse(memory.get(props.draftKey));saved.minimumLandingMassApplicability.documentaryRuleKey='stale reference';memory.set(props.draftKey,JSON.stringify(saved));
    render=harness(props);tree=render();assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,false);
    field(tree,'Confirmer l’applicabilité MLM').props.onChange({target:{checked:true}});tree=render();
    props.dossier={...props.dossier,balloon:{...props.dossier.balloon,weights:{...props.dossier.balloon.weights,basketKg:151}}};
    props.loadInput={...props.loadInput,balloonEquipmentWeightKg:451};
    render=harness(props);tree=render();assert.equal(field(tree,'Confirmer l’applicabilité MLM').props.checked,false);
    assert.equal(JSON.parse(memory.get(props.draftKey)).minimumLandingMassApplicability,undefined);
  } finally {globalThis.sessionStorage=previousStorage;globalThis.document=previousDocument;}
});

test('Morocco PDF stores the estimated landing mass, validated MLM and independent editable fields after saving',async()=>{
  const input=await fixture();
  const rule=MOROCCO_LANDING_MASS_RULES.find(r=>r.model==='Z105');
  input.minimumLandingMassApplicability={manualSha256:rule.source.sha256,variant:rule.variant,documentaryRuleKey:minimumModule.moroccoLandingMassRuleKey(rule),balloonConfigurationKey:minimumModule.moroccoLandingMassConfigurationKey(input.dossier.balloon),configurationReference:'Test reviewed configuration',manualApplicabilityConfirmed:true,normalOperation:true,supplementsReview:'NO_MLM_OVERRIDE'};
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,{error:'offline'})),form=pdf.getForm();
  for(const [name,value] of Object.entries({'charge-masse-prevue':'595','charge-gaz-consomme-prevu':'70','charge-propane-embarque':'100','charge-masse-atterrissage-estimee':'525','charge-masse-minimale-atterrissage':'476','charge-marge-mlm':'49'})) assert.equal(form.getTextField(name).getText(),value,name);
  form.getTextField('charge-gaz-consomme-prevu').setText('80');
  const reopened=await PDFDocument.load(await pdf.save());assert.equal(reopened.getForm().getTextField('charge-gaz-consomme-prevu').getText(),'80');assert.equal(reopened.getForm().getTextField('charge-masse-atterrissage-estimee').getText(),'525');
  assert.equal(reopened.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length,39);
  const missing=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,minimumLandingMassApplicability:undefined},{error:'offline'}));
  assert.equal(missing.getForm().getTextField('charge-masse-minimale-atterrissage').getText()??'','');assert.equal(missing.getForm().getTextField('charge-marge-mlm').getText(),'indisponible');
  const pageStreams=missing.getPages().flatMap(page=>{const contents=page.node.Contents();return Array.from({length:contents.size()},(_,i)=>Buffer.from(decodePDFRawStream(contents.lookup(i)).decode()).toString());}).join('\n');
  assert.ok(pageStreams.includes(Buffer.from('Courbe constructeur Cameron non disponible').toString('hex').toUpperCase()));
});
