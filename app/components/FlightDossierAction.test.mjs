import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as reference from '../lib/moroccoDossierReference.ts';
const require=createRequire(import.meta.url);
function harness(t,prepared){
  const old=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;});
  const slots=[];let cursor=0,pending=[];const calls={prepare:0,weather:0,france:[],morocco:[]};let tree;
  const react={useId:()=> 'menu-test',useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},useEffect(fn,deps){const i=cursor++;const previous=slots[i];if(!previous||deps.some((d,j)=>d!==previous.deps[j])){slots[i]={deps};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}}};
  const Dialog=()=>null;
  const mocks={react,'../lib/moroccoPreparationClient':{loadMoroccoDossierPreparation:async dossier=>{calls.weather++;return {dossier,weather:null};}},'./MoroccoPassengerDialog':Dialog,'../lib/moroccoDossierReference':reference,'../lib/flightDossierWeatherClient':{loadFlightDossierWeather:async()=>{calls.weather++;return null;}},'../lib/moroccoFlightDossierExport':{exportMoroccoFlightDossier:async input=>{calls.morocco.push(input);return{mapUnavailable:false};}},'../lib/flightDossierExport':{exportFlightDossier:async input=>{calls.france.push(input);return{mapUnavailable:false};}},'./FlightDossierOperationsSummary':()=>null,'./FlightDossierWeatherSummary':()=>null,'../lib/balloons':{balloonDisplayName:()=> 'Ballon test'},'../lib/timeZone.ts':{formatInTimeZone:()=> '07:00'},'lucide-react':{FileDown:()=>null,LoaderCircle:()=>null,X:()=>null}};
  const js=ts.transpileModule(readFileSync(new URL('./FlightDossierAction.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',js)(id=>id in mocks?mocks[id]:require(id),exports);
  const trace={traceId:'test',model:{label:'TEST'},label:'Stratégie'};
  const walk=(n,p,out=[])=>{if(n&&typeof n==='object'){if(p(n))out.push(n);for(const c of [n.props?.children].flat(Infinity))walk(c,p,out);}return out;};
  const all=p=>walk(tree,p);
  const render=()=>{cursor=0;tree=exports.default({trace,onFlightDossier:()=>{calls.prepare++;return prepared;}});for(const n of all(n=>n.props?.ref))n.props.ref.current={focus(){}};const effects=pending;pending=[];effects.forEach(fn=>fn());};
  const open=country=>{all(n=>n.type==='button'&&n.props['aria-label']==='Dossier de vol PDF')[0].props.onClick();render();all(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.some(c=>typeof c==='string'&&c.trim()===country))[0].props.onClick();render();};
  t.after(()=>slots.forEach(s=>s?.cleanup?.()));render();return{calls,all,render,open,Dialog};
}
const prepared=()=>({status:'READY',data:{traceId:'test',startedAt:'2026-11-05T23:30:00Z',landingAt:'2026-11-06T00:30:00Z',launchTimeZone:'Africa/Casablanca',durationSeconds:3600,model:{label:'TEST'},points:[],balloon:{}}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Maroc opens passenger entry with dossier date before any weather/export; cancellation exports nothing',t=>{
  const h=harness(t,prepared());h.open('Maroc');const dialog=h.all(n=>n.type===h.Dialog)[0];assert.ok(dialog);assert.equal(dialog.props.reference.date,'2026-11-06');assert.equal(dialog.props.reference.time,'00:30');assert.equal(dialog.props.reference.timeZone,'Africa/Casablanca');
  assert.equal(h.calls.prepare,1);assert.equal(h.calls.weather,0);assert.equal(h.calls.morocco.length,0);dialog.props.onCancel();h.render();assert.equal(h.all(n=>n.type===h.Dialog).length,0);
});
test('confirmed passenger rows reach only Morocco, using the same prepared dossier',async t=>{
  const ready=prepared(),h=harness(t,ready);h.open('Maroc');const rows=[{lastName:'Nom',firstName:'Prénom',nationality:'Marocaine',sex:'H'}];
  h.all(n=>n.type===h.Dialog)[0].props.onExport(rows,{date:'2026-11-12',time:'08:15'});await flush();assert.equal(h.calls.prepare,1);assert.equal(h.calls.morocco.length,1);assert.equal(h.calls.morocco[0].dossier,ready.data);assert.equal(h.calls.morocco[0].passengers,rows);assert.deepEqual(h.calls.morocco[0].dossierReference,{date:'2026-11-12',time:'08:15'});assert.equal(h.calls.france.length,0);
});
test('France still exports directly without passenger dialog or passenger data',async t=>{
  const h=harness(t,prepared());h.open('France');await flush();assert.equal(h.all(n=>n.type===h.Dialog).length,0);assert.equal(h.calls.france.length,1);assert.equal('passengers' in h.calls.france[0],false);assert.equal('dossierReference' in h.calls.france[0],false);assert.equal(h.calls.morocco.length,0);
});

test('invalid preparation clock is reported before opening the passenger dialog or starting export',t=>{
  const ready=prepared();ready.data.startedAt='invalid';const h=harness(t,ready);h.open('Maroc');
  assert.equal(h.all(n=>n.type===h.Dialog).length,0);assert.equal(h.calls.weather,0);assert.equal(h.calls.morocco.length,0);
  assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('Date/heure de préparation invalide')));
});
