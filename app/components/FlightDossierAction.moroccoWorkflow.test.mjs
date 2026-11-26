import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PDFDocument,PDFCheckBox,decodePDFRawStream} from 'pdf-lib';
import {moroccoWorkflowFixture} from '../lib/moroccoWorkflow.fixtures.mjs';
import * as reference from '../lib/moroccoDossierReference.ts';
import * as loading from '../lib/moroccoDossierLoading.ts';
import * as minimum from '../lib/moroccoMinimumLandingMass.ts';
import * as balloons from '../lib/balloons.ts';
import * as zone from '../lib/timeZone.ts';
import {loadMoroccoDossierPreparation} from '../lib/moroccoPreparationClient.ts';
import {exportMoroccoFlightDossier} from '../lib/moroccoFlightDossierExport.ts';
import {createMoroccoFlightDossierPdf} from '../lib/moroccoFlightDossierPdf.ts';
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const streams=pdf=>pdf.getPages().flatMap(p=>{const c=p.node.Contents();return Array.from({length:c.size()},(_,i)=>Buffer.from(decodePDFRawStream(c.lookup(i)).decode()).toString());}).join('\n');
const has=(pdf,text)=>streams(pdf).includes(Buffer.from(text,'latin1').toString('hex').toUpperCase());
function harness(props,store,download){
 const slots=[];let cursor=0,effects=[],tree;const dialog=()=>null;
 const react={useId:()=> 'pdf-test',useRef(v){const i=cursor++;return slots[i]??(slots[i]={current:v});},useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old[j])){slots[i]=deps;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props});const mocks={react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'./MoroccoPassengerDialog':{__esModule:true,default:dialog},'./FlightDossierOperationsSummary':{},'./FlightDossierWeatherSummary':{},
  '../lib/moroccoDossierLoading':loading,'../lib/moroccoMinimumLandingMass':minimum,'../lib/balloons':balloons,'../lib/timeZone.ts':zone,
  '../lib/moroccoDossierReference':{...reference,moroccoDossierOpeningReference:()=>reference.moroccoDossierOpeningReference(new Date('2026-11-26T07:30:00Z'),'America/New_York')},
  '../lib/flightDossierWeatherClient':{loadFlightDossierWeather(){throw Error('France branch must not execute');}},
  '../lib/moroccoPreparationClient':{loadMoroccoDossierPreparation:(d,s)=>loadMoroccoDossierPreparation(d,s,{store,memoryArchive:null})},
  '../lib/moroccoFlightDossierExport':{exportMoroccoFlightDossier:(input,signal)=>exportMoroccoFlightDossier(input,signal,{renderMap:async()=>({error:'Fond hors ligne non disponible'}),createPdf:createMoroccoFlightDossierPdf,download})}};
 const js=ts.transpileModule(readFileSync(new URL('./FlightDossierAction.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={};new Function('require','exports',js)(id=>{assert.ok(id in mocks,id);return mocks[id];},exports);
 const render=()=>{cursor=0;effects=[];tree=exports.default(props);effects.forEach(fn=>fn());return tree;};render();render();
 return{render,get tree(){return tree;},get dialog(){return nodes(tree).find(n=>n.type===dialog);}};
}
test('ordinary preparation -> PDF menu -> Morocco form -> antedated offline PDF, without destination mode or trajectory recalculation',async t=>{
 const input=await moroccoWorkflowFixture(),oldDocument=globalThis.document,oldFetch=globalThis.fetch;
 globalThis.document={addEventListener(){},removeEventListener(){}};globalThis.fetch=async()=>{throw Error('No export network request allowed');};
 t.after(()=>{globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
 let resolveDownload;const downloaded=new Promise(resolve=>resolveDownload=resolve);
 const props={trace:input.trajectory,timeZone:input.dossier.launchTimeZone,moroccoLoadInput:input.loadInput,moroccoCanonicalAltitudeAmslM:1000,onFlightDossier:()=>({status:'READY',data:input.dossier})};
 const before=JSON.stringify(input.dossier),h=harness(props,input.store,(bytes,filename)=>resolveDownload({bytes,filename}));
 nodes(h.tree).find(n=>n.type==='button'&&n.props['aria-label']==='Dossier de vol PDF').props.onClick();h.render();
 assert.equal(nodes(h.tree).filter(n=>n.type==='input').length,0);
 const countries=nodes(h.tree).filter(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.some(c=>typeof c==='string'&&/France|Maroc/.test(c)));
 assert.equal(countries.length,2);countries.find(n=>n.props.children.some(c=>c===' Maroc')).props.onClick();h.render();
 assert.equal(h.dialog.props.reference.time,'02:30');assert.equal(h.dialog.props.reference.timeZone,'America/New_York');
 h.dialog.props.onExport(input.passengers,{date:'2020-01-02',time:'08:30',timeZone:'America/New_York'},input.loading,undefined,1000);
 const timer=setTimeout(()=>resolveDownload({error:'Export timeout'}),4000);const result=await downloaded;clearTimeout(timer);assert.ok(!result.error,result.error);
 assert.match(result.filename,/2020-01-02/);const pdf=await PDFDocument.load(result.bytes),form=pdf.getForm();
 assert.ok(has(pdf,'Rédaction antidatée'));assert.ok(has(pdf,'LFQQ 050800Z'));assert.ok(has(pdf,'Europe/Paris'));
 assert.equal(form.getTextField('pax-heure').getText(),'08:30');assert.equal(form.getTextField('pax-date').getText(),'02/01/2020');
 for(const[name,value]of Object.entries({'charge-masse-prevue':'1 041','charge-gaz-consomme-prevu':'70','charge-masse-atterrissage-estimee':'971','charge-masse-minimale-atterrissage':'1 247','charge-marge-mlm':'-276'}))assert.equal(form.getTextField(name).getText(),value);
 assert.ok(has(pdf,"Masse minimale à l'atterrissage non respectée"));assert.ok(has(pdf,'Autonomie carburant non vérifiée'));
 assert.equal(form.getTextField('fpl-maroc-13t').getText(),'1000');assert.match(form.getTextField('fpl-maroc-18').getText(),/DOF\/261105/);
 assert.equal(form.getFields().filter(f=>f instanceof PDFCheckBox).length,39);assert.equal(form.getFields().filter(f=>f.getName().startsWith('fpl-maroc-')).length,29);
 form.getTextField('charge-masse-minimale-atterrissage').setText('1250');const reopened=await PDFDocument.load(await pdf.save());assert.equal(reopened.getForm().getTextField('charge-masse-minimale-atterrissage').getText(),'1250');assert.equal(reopened.getForm().getTextField('charge-masse-minimale-atterrissage').isReadOnly(),false);
 assert.equal(JSON.stringify(input.dossier),before);
});

test('missing calculation evidence still permits offline PDF export without any weather replacement',async t=>{
 const input=await moroccoWorkflowFixture(),oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('No substitute weather');};t.after(()=>{globalThis.fetch=oldFetch;});
 const prepared=await loadMoroccoDossierPreparation(input.dossier,undefined,{store:{matching:async()=>[],saveOnce:async()=>{}},memoryArchive:null});
 assert.equal(calls,0);assert.equal(prepared.weather.altitudeWind.status,'UNAVAILABLE');assert.equal(prepared.weather.landingGroundWind.status,'UNAVAILABLE');
 let bytes;await exportMoroccoFlightDossier({...prepared,passengers:input.passengers,loading:input.loading,loadInput:input.loadInput,dossierReference:{date:'2020-01-02',time:'08:30',timeZone:'America/New_York'}},undefined,{renderMap:async()=>({error:'Fond hors ligne non disponible'}),createPdf:createMoroccoFlightDossierPdf,download:buffer=>{bytes=buffer;}});
 const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length,39);
 assert.ok(has(pdf,'Aucun rechargement ni substitution'));assert.equal(pdf.getForm().getTextField('charge-masse-atterrissage-estimee').getText(),'971');assert.equal(calls,0);
});
