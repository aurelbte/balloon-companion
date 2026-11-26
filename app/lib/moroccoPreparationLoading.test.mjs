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

test('charge altitude prioritizes the actual preparation, supports its load snapshot and never falls back to map layers',()=>{
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl({plannedMaximumAltitudeMslM:1000},1500,600),1500);
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl({plannedMaximumAltitudeMslM:1000},undefined,600),1000);
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl({plannedMaximumAltitudeMslM:undefined},undefined,1200),1200);
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl(undefined,0,600),0);
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl(undefined,null,600),null); // Explicitly cleared canonical value.
  assert.equal(loadingModule.moroccoChargeAltitudeAmsl({altitudesAmslM:[1000],primaryAltitudeAmslM:1000},undefined,undefined),null);
});

test('70 kg is an aircraft-specific pilot estimate, never a Z275 manufacturer default',async()=>{
  const {dossier}=await fixture();const b={...dossier.balloon,registration:'CN-CBN',model:'Z-275'};
  assert.equal(loadingModule.moroccoDefaultGasConsumption(b),70);
  for(const patch of [{registration:'CN-OTHER'},{model:'Z105'},{manufacturer:'Ultramagic'}]) assert.equal(loadingModule.moroccoDefaultGasConsumption({...b,...patch}),undefined);
});

test('one takeoff total uses profile gross masses; legacy PAX fuel and theoretical capacities never prove net propane',async()=>{
  const input=await fixture(), prepared=loadingModule.applyMoroccoDossierLoading(input);
  assert.equal(prepared.dossier.operations.load.plannedMassKg,595); // 450 equipped + 80 PAX + 60 + 5; propane not added twice.
  const landing=loadingModule.calculateMoroccoLandingMass(prepared);
  assert.equal(landing.landingKg,525);assert.equal(landing.minimum.kg,null);assert.equal(landing.marginKg,525-landing.minimum.displayKg);
  assert.equal(landing.notice,'Autonomie carburant non vérifiée');
  assert.deepEqual(landing.fuelAutonomy,{status:'UNVERIFIED',availableKg:null});assert.equal(landing.propaneOnBoardKg,null);
  assert.equal(loadingModule.applyMoroccoDossierLoading(prepared).dossier.operations.load.plannedMassKg,595);
  for(const change of [v=>delete v.loading.fuel, v=>v.loading.fuel.fullCylinderMassesConfirmed=false,
    v=>v.loading.fuel.configurationKey='different',v=>v.loading.fuel.propaneOnBoardKg=999,
    v=>v.dossier.balloon.fuelCapacityKg=200, v=>v.dossier.balloon.weights.fullCylinders[0].capacityLitres=80]) {
    const v=structuredClone(prepared);change(v);const result=loadingModule.calculateMoroccoLandingMass(v);
    assert.equal(result.landingKg,525);assert.equal(result.fuelAutonomy.status,'UNVERIFIED');assert.equal(result.propaneOnBoardKg,null);
  }
  const missing=structuredClone(prepared);delete missing.loading.expectedGasConsumptionKg;
  assert.match(loadingModule.calculateMoroccoLandingMass(missing).notice,/Gaz consommé prévu manquant/);
  for(const gas of [-1,NaN,Infinity]) assert.throws(()=>loadingModule.applyMoroccoDossierLoading({...input,loading:{...input.loading,expectedGasConsumptionKg:gas}}));
  const impossible=loadingModule.applyMoroccoDossierLoading({...input,loading:{...input.loading,expectedGasConsumptionKg:151}});
  assert.match(loadingModule.calculateMoroccoLandingMass(impossible).notice,/supérieur à la masse totale/);
  const zero=loadingModule.applyMoroccoDossierLoading({...input,loading:{...input.loading,expectedGasConsumptionKg:0}});
  assert.equal(loadingModule.calculateMoroccoLandingMass(zero).landingKg,595); // Explicit zero; no missing fuel quantity replaced by zero.
  assert.throws(()=>loadingModule.applyMoroccoDossierLoading({...input,loadInput:{...input.loadInput,balloonId:'another'}}),/changé/);
});

test('landing mass blocks theoretical, unknown, stale or missing takeoff masses without claiming fuel autonomy',async()=>{
  const prepared=loadingModule.applyMoroccoDossierLoading(await fixture());
  const configurationKey=minimumModule.moroccoLandingMassConfigurationKey(prepared.dossier.balloon);
  assert.equal(loadingModule.calculateMoroccoLandingMass({...prepared,takeoffMassBasis:{kind:'DECLARED_CONFIGURATION',configurationKey}}).landingKg,525);
  const theoretical=loadingModule.calculateMoroccoLandingMass({...prepared,takeoffMassBasis:{kind:'THEORETICAL',configurationKey}});
  assert.equal(theoretical.landingKg,null);assert.match(theoretical.notice,/théorique/);
  for(const basis of [{kind:'UNKNOWN',configurationKey},{kind:'DECLARED_CONFIGURATION',configurationKey:'other-configuration'}]) {
    const result=loadingModule.calculateMoroccoLandingMass({...prepared,takeoffMassBasis:basis});assert.equal(result.landingKg,null);assert.match(result.notice,/Provenance/);
  }
  for(const mutate of [v=>v.dossier.operations.load.plannedMassKg=null,v=>v.dossier.operations.load.plannedMassKg=NaN,
    v=>v.dossier.operations.load.plannedMassKg=500,v=>v.dossier.balloon.weights.fullCylinders=[],
    v=>delete v.dossier.balloon.weights.envelopeKg,v=>v.loadInput.balloonEquipmentWeightKg=NaN,
    v=>v.dossier.balloon.weights.fullCylinders[0].fullWeightKg=151]) {
    const value=structuredClone(prepared);mutate(value);const result=loadingModule.calculateMoroccoLandingMass(value);
    assert.equal(result.landingKg,null);assert.equal(result.marginKg,null);assert.equal(result.fuelAutonomy.status,'UNVERIFIED');
  }
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

test('dialog displays an existing preparation/snapshot altitude even without a load-input altitude, never an altitude layer',async()=>{
  const input=await fixture(),previousDocument=globalThis.document;globalThis.document={body:{}};
  try {
    let exported,committed;
    const props={dossier:input.dossier,loadInput:{...input.loadInput,plannedMaximumAltitudeMslM:undefined},canonicalAltitudeAmslM:1500,
      reference:referenceModule.resolveMoroccoDossierReference(input.dossier),onCancel(){},onAltitudeChange(value){committed=value;},onExport(...args){exported=args;}};
    let tree=harness(props)();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(committed,1500);assert.equal(exported[4],1500);
    delete props.canonicalAltitudeAmslM;
    tree=harness(props)();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1000');
    props.canonicalAltitudeAmslM=null;
    tree=harness(props)();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'');
    delete props.canonicalAltitudeAmslM;
    props.dossier={...props.dossier,operations:{...props.dossier.operations,load:{...props.dossier.operations.load,plannedMaximumAltitudeMslM:null}}};
    props.loadInput.altitudesAmslM=[1000];props.loadInput.primaryAltitudeAmslM=1000;
    tree=harness(props)();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'');
  } finally {globalThis.document=previousDocument;}
});

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
    assert.ok(nodes(tree).some(n=>n.type==='dd'&&n.props.children==='445 kg'));
    assert.ok(nodes(tree).some(n=>n.type==='p'&&n.props.children==='Autonomie carburant non vérifiée'));
    field(tree,'Gaz consommé prévu (kg)').props.onChange({target:{value:'61'}});tree=render();
    field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:'1500'}});tree=render();assert.equal(canonical,1000);
    field(tree,'Altitude de vol projetée (m AMSL)').props.onBlur();tree=render();assert.equal(canonical,1500);
    assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    render=harness(props);tree=render();assert.equal(field(tree,'Gaz consommé prévu (kg)').props.value,'61');assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    field(tree,'Altitude de vol projetée (m AMSL)').props.onChange({target:{value:''}});tree=render();
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported,0);assert.equal(canonical,1500);
    render=harness(props);tree=render();assert.equal(field(tree,'Altitude de vol projetée (m AMSL)').props.value,'1500');
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported,1);
    assert.equal(field(tree,'Propane embarqué (kg)'),undefined);
    assert.equal(field(tree,'Édition du manuel MLM'),undefined);
    assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0);
    props.dossier={...props.dossier,balloon:{...props.dossier.balloon,weights:{...props.dossier.balloon.weights,basketKg:151}}};
    props.loadInput={...props.loadInput,balloonEquipmentWeightKg:451};
    render=harness(props);tree=render();
    assert.equal(field(tree,'Gaz consommé prévu (kg)').props.value,'61');
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

test('simplified dialog only reuses an existing applicable MLM proof and ignores old manual fuel entries',async()=>{
  const input=await fixture();Object.assign(input.dossier.balloon,{model:'Z275',volumeM3:7788});input.loadInput={...input.loadInput,model:'Z275',volumeM3:7788};
  const rule=minimumModule.moroccoLandingMassRulesForBalloon(input.dossier.balloon)[0];
  const memory=new Map(),previousStorage=globalThis.sessionStorage,previousDocument=globalThis.document;
  globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)??null};globalThis.document={body:{}};
  try {
    let exported;
    const props={dossier:input.dossier,loadInput:input.loadInput,draftKey:'mlm-existing',reference:referenceModule.resolveMoroccoDossierReference(input.dossier),onCancel(){},onExport(...args){exported=args;}};
    let render=harness(props),tree=render();
    assert.equal(field(tree,'Édition du manuel MLM'),undefined);assert.equal(field(tree,'Confirmer l’applicabilité MLM'),undefined);
    nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported[3],undefined);
    const saved=JSON.parse(memory.get(props.draftKey));
    saved.gas='61';saved.propane='100';saved.fuelConfirmed=true;
    saved.minimumLandingMassApplicability={manualSha256:rule.source.sha256,variant:rule.variant,documentaryRuleKey:minimumModule.moroccoLandingMassRuleKey(rule),balloonConfigurationKey:minimumModule.moroccoLandingMassConfigurationKey(input.dossier.balloon),configurationReference:'Existing test review',manualApplicabilityConfirmed:true,normalOperation:true,supplementsReview:'NO_MLM_OVERRIDE'};
    memory.set(props.draftKey,JSON.stringify(saved));
    render=harness(props);tree=render();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(minimumModule.moroccoMinimumLandingMass(props.dossier.balloon,exported[3]).kg,1247);
    assert.equal(exported[2].fuel,undefined);assert.equal(exported[2].expectedGasConsumptionKg,61);
    assert.equal(field(tree,'Propane embarqué (kg)'),undefined);
    assert.equal(JSON.parse(memory.get(props.draftKey)).propane,'100'); // Retain old data; never treat it as profile fuel evidence.
    const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,passengers:exported[0],loading:exported[2],minimumLandingMassApplicability:exported[3]},{error:'offline'}));
    assert.equal(pdf.getForm().getTextField('charge-masse-minimale-atterrissage').getText(),'1 247');
    const stale=JSON.parse(memory.get(props.draftKey));stale.minimumLandingMassApplicability.documentaryRuleKey='stale reference';memory.set(props.draftKey,JSON.stringify(stale));
    render=harness(props);tree=render();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(exported[3],undefined);
  } finally {globalThis.sessionStorage=previousStorage;globalThis.document=previousDocument;}
});

test('Morocco PDF stores the estimated landing mass, validated MLM and independent editable fields after saving',async()=>{
  const input=await fixture();
  const rule=MOROCCO_LANDING_MASS_RULES.find(r=>r.model==='Z105');
  input.minimumLandingMassApplicability={manualSha256:rule.source.sha256,variant:rule.variant,documentaryRuleKey:minimumModule.moroccoLandingMassRuleKey(rule),balloonConfigurationKey:minimumModule.moroccoLandingMassConfigurationKey(input.dossier.balloon),configurationReference:'Test reviewed configuration',manualApplicabilityConfirmed:true,normalOperation:true,supplementsReview:'NO_MLM_OVERRIDE'};
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,{error:'offline'})),form=pdf.getForm();
  for(const [name,value] of Object.entries({'charge-masse-prevue':'595','charge-gaz-consomme-prevu':'70','charge-masse-atterrissage-estimee':'525','charge-masse-minimale-atterrissage':'476','charge-marge-mlm':'49'})) assert.equal(form.getTextField(name).getText(),value,name);
  form.getTextField('charge-gaz-consomme-prevu').setText('80');
  const reopened=await PDFDocument.load(await pdf.save());assert.equal(reopened.getForm().getTextField('charge-gaz-consomme-prevu').getText(),'80');assert.equal(reopened.getForm().getTextField('charge-masse-atterrissage-estimee').getText(),'525');
  assert.equal(reopened.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length,39);
  const missing=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,minimumLandingMassApplicability:undefined},{error:'offline'}));
  assert.equal(missing.getForm().getTextField('charge-masse-minimale-atterrissage').getText(),'476');assert.equal(missing.getForm().getTextField('charge-marge-mlm').getText(),'49');
  assert.throws(()=>form.getTextField('charge-propane-embarque'));
  const zero=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,loading:{...input.loading,expectedGasConsumptionKg:0}},{error:'offline'}));
  assert.equal(zero.getForm().getTextField('charge-masse-atterrissage-estimee').getText(),'595');assert.equal(zero.getForm().getTextField('charge-marge-mlm').getText(),'119');
  const pageStreams=missing.getPages().flatMap(page=>{const contents=page.node.Contents();return Array.from({length:contents.size()},(_,i)=>Buffer.from(decodePDFRawStream(contents.lookup(i)).decode()).toString());}).join('\n');
  assert.ok(pageStreams.includes(Buffer.from('Courbe constructeur Cameron non disponible').toString('hex').toUpperCase()));
  assert.ok(pageStreams.includes(Buffer.from('Autonomie carburant non vérifiée','latin1').toString('hex').toUpperCase()));
  const theoretical=await PDFDocument.load(await createMoroccoFlightDossierPdf({...input,takeoffMassBasis:{kind:'THEORETICAL',configurationKey:minimumModule.moroccoLandingMassConfigurationKey(input.dossier.balloon)}},{error:'offline'}));
  assert.equal(theoretical.getForm().getTextField('charge-masse-atterrissage-estimee').getText(),'indisponible');
  assert.throws(()=>theoretical.getForm().getTextField('charge-marge-mlm'));
});


test('opening clock defaults to now; manual dossier clock survives remount and automatic clock refreshes independently of planned takeoff',async()=>{
  const input=await fixture(), memory=new Map(), oldStorage=globalThis.sessionStorage, oldDocument=globalThis.document;
  globalThis.sessionStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};globalThis.document={body:{}};
  try {
    const props={dossier:input.dossier,loadInput:input.loadInput,draftKey:'opening-clock',reference:referenceModule.moroccoDossierOpeningReference(new Date('2026-11-26T07:30:00Z'),'Africa/Casablanca'),onCancel(){},onExport(){}};
    let render=harness(props), tree=render();
    const byType=type=>nodes(tree).find(n=>n.type==='input'&&n.props.type===type);
    assert.equal(byType('date').props.value,'2026-11-26');assert.equal(byType('time').props.value,'08:30');
    props.reference=referenceModule.moroccoDossierOpeningReference(new Date('2026-11-26T08:45:00Z'),'Africa/Casablanca');
    render=harness(props);tree=render();assert.equal(byType('time').props.value,'09:45');
    byType('date').props.onChange({target:{value:'2026-11-25'}});tree=render();byType('time').props.onChange({target:{value:'19:23'}});tree=render();
    props.reference=referenceModule.moroccoDossierOpeningReference(new Date('2026-11-26T09:00:00Z'),'Africa/Casablanca');
    tree=harness(props)();assert.equal(byType('time').props.value,'19:23');assert.equal(byType('date').props.value,'2026-11-25');
    assert.equal(referenceModule.resolveMoroccoDossierReference(input.dossier,{date:'2026-11-25',time:'19:23'}).iso,'2026-11-25T18:23:00.000Z');
  } finally {globalThis.sessionStorage=oldStorage;globalThis.document=oldDocument;}
});

test('manual writing timezone survives reopening on a device in another zone and remains distinct from takeoff',async()=>{
 const input=await fixture(),memory=new Map(),oldStorage=globalThis.sessionStorage,oldDocument=globalThis.document;
 globalThis.sessionStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};globalThis.document={body:{}};
 try {
  let exported;
  const props={dossier:{...input.dossier,launchTimeZone:'Africa/Casablanca'},loadInput:input.loadInput,draftKey:'writing-zone',reference:referenceModule.moroccoDossierOpeningReference(new Date('2026-11-26T07:30:00Z'),'America/New_York'),onExport:(...args)=>{exported=args;},onCancel(){}};
  let render=harness(props),tree=render();const byType=type=>nodes(tree).find(n=>n.type==='input'&&n.props.type===type);
  assert.equal(byType('time').props.value,'02:30');byType('time').props.onChange({target:{value:'03:05'}});tree=render();
  props.reference=referenceModule.moroccoDossierOpeningReference(new Date('2026-11-26T07:45:00Z'),'Asia/Tokyo');
  tree=harness(props)();assert.equal(byType('time').props.value,'03:05');nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(exported[1].timeZone,'America/New_York');assert.equal(exported[1].time,'03:05');assert.equal(props.dossier.launchTimeZone,'Africa/Casablanca');
 } finally {globalThis.sessionStorage=oldStorage;globalThis.document=oldDocument;}
});
