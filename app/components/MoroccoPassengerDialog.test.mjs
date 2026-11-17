import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as passengers from '../lib/moroccoPassengers.ts';
import * as reference from '../lib/moroccoDossierReference.ts';
import * as loading from '../lib/moroccoDossierLoading.ts';
const require=createRequire(import.meta.url);
function harness(t,options={}){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{}}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;});
  const slots=[];let cursor=0;const effects=[];const exported=[];const references=[];const loadings=[];let cancelled=0;let shown=0;let tree;
  const react={useId:()=> 'passenger-test',useRef:initial=>slots[cursor++]??=( {current:initial} ),useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){slots[i]={deps};effects.push(fn);}}};
  const mocks={react,'../lib/moroccoDossierLoading':loading,'react-dom':{createPortal:node=>node},'../lib/moroccoPassengers':passengers,'../lib/moroccoDossierReference':reference};
  const js=ts.transpileModule(readFileSync(new URL('./MoroccoPassengerDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',js)(id=>id in mocks?mocks[id]:require(id),exports);
  const walk=(n,p,out=[])=>{if(n&&typeof n==='object'){if(p(n))out.push(n);for(const c of [n.props?.children].flat(Infinity))walk(c,p,out);}return out;};
  const render=()=>{cursor=0;tree=exports.default({...options,reference:reference.resolveMoroccoDossierReference({startedAt:'2026-11-05T23:30:00Z',launchTimeZone:'Africa/Casablanca'}),onCancel:()=>cancelled++,onExport:(rows,ref,masses)=>{exported.push(rows);references.push(ref);loadings.push(masses);}});tree.props.ref.current={showModal(){shown++;}};while(effects.length)effects.shift()();return tree;};
  const all=p=>walk(tree,p);const row=i=>all(n=>n.type==='fieldset')[i];
  const change=(i,type,value)=>{const field=walk(row(i),n=>n.type===type)[0];field.props.onChange({target:{value}});render();};
  const submit=()=>{all(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});render();};
  render();return{all,row,change,submit,render,remount(){slots.length=0;cursor=0;effects.length=0;render();},exported,references,loadings,get cancelled(){return cancelled;},get shown(){return shown;},get tree(){return tree;}};
}
test('thirteen blank slots; category change immediately displays H/F/E weights before export',t=>{
  const h=harness(t);assert.equal(h.shown,1);assert.equal(h.all(n=>n.type==='fieldset').length,13);
  assert.ok(h.all(n=>n.type==='input'&&n.props.inputMode==='decimal').every(n=>n.props.value===''));
  for(const [i,sex]of['H','F','E'].entries())h.change(i,'select',sex);
  assert.deepEqual(h.all(n=>n.type==='input'&&n.props.inputMode==='decimal').slice(0,3).map(n=>n.props.value),['92','74','35']);
  h.submit();assert.equal(h.exported.length,1);assert.deepEqual(h.exported[0].slice(0,3).map(r=>r.sex),['H','F','E']);
});
test('free text is retained and missing sex prevents export with an explicit row error',t=>{
  const h=harness(t);h.change(0,'input','D’Artagnan');h.submit();assert.equal(h.exported.length,0);
  assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('Passager 1')));
  h.change(0,'select','F');h.submit();assert.equal(h.exported[0][0].lastName,'D’Artagnan');
});
test('cancellation, including Escape, never starts export; all unused slots may remain blank',t=>{
  const h=harness(t);h.tree.props.onCancel({preventDefault(){}});assert.equal(h.cancelled,1);assert.equal(h.exported.length,0);
  h.all(n=>n.type==='button'&&n.props.children==='Annuler')[0].props.onClick();assert.equal(h.cancelled,2);
  h.submit();assert.equal(h.exported.length,1);assert.ok(h.exported[0].every(r=>r.sex===''));
});

const weightInput=h=>h.all(n=>n.type==='input'&&n.props.inputMode==='decimal')[0];
const editWeight=(h,value)=>{weightInput(h).props.onChange({target:{value}});h.render();};
test('custom weight survives sex changes and reaches export unchanged; Auto explicitly restores category defaults',t=>{
  const h=harness(t);h.change(0,'select','H');editWeight(h,'81,5');
  for(const sex of ['F','E','H']){h.change(0,'select',sex);assert.equal(weightInput(h).props.value,'81,5');}
  h.submit();assert.equal(h.exported[0][0].customWeightKg,81.5);
  h.change(0,'select','E');h.all(n=>n.type==='button'&&n.props['aria-label']==='Rétablir le poids automatique du passager 1')[0].props.onClick();h.render();assert.equal(weightInput(h).props.value,'35');
  h.change(0,'select','F');assert.equal(weightInput(h).props.value,'74');
});
test('invalid or cleared custom weight prevents export until Auto is explicitly selected',t=>{
  const h=harness(t);h.change(0,'select','H');
  for(const raw of ['0','-5','abc']){editWeight(h,raw);h.submit();assert.equal(h.exported.length,0);assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('poids personnalisé')));}
  editWeight(h,'');h.submit();assert.equal(h.exported.length,0);h.all(n=>n.type==='button'&&n.props['aria-label']==='Rétablir le poids automatique du passager 1')[0].props.onClick();h.render();assert.equal(weightInput(h).props.value,'92');h.submit();assert.equal(h.exported.length,1);
});

test('editable local dossier date and time are prefilled from preparation and forwarded on export',t=>{
  const h=harness(t);const field=type=>h.all(n=>n.type==='input'&&n.props.type===type)[0];
  assert.equal(field('date').props.value,'2026-11-06');assert.equal(field('time').props.value,'00:30');
  field('date').props.onChange({target:{value:'2026-11-12'}});h.render();field('time').props.onChange({target:{value:'08:15'}});h.render();h.submit();
  assert.deepEqual(h.references[0],{date:'2026-11-12',time:'08:15'});
});
test('invalid dossier date or time blocks export without changing passenger entries',t=>{
  const h=harness(t);h.change(0,'select','F');editWeight(h,'81,5');
  h.all(n=>n.type==='input'&&n.props.type==='date')[0].props.onChange({target:{value:'2026-02-30'}});h.render();h.submit();
  assert.equal(h.exported.length,0);assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('Date/heure')));assert.equal(weightInput(h).props.value,'81,5');
});

test('pilot/equipment defaults and edits feed the one validated loading payload; removing passengers updates its count',t=>{
 const h=harness(t), mass=label=>h.all(n=>n.type==='input'&&n.props['aria-label']===label)[0];
 assert.equal(mass('Pilote (kg)').props.value,'60');assert.equal(mass('Équipement (kg)').props.value,'5');
 h.change(0,'select','H');h.change(1,'select','F');h.submit();assert.deepEqual(h.loadings.at(-1),{pilotKg:60,equipmentKg:5,passengerCount:2});
 mass('Pilote (kg)').props.onChange({target:{value:'75'}});h.render();mass('Équipement (kg)').props.onChange({target:{value:'8'}});h.render();
 h.all(n=>n.type==='button'&&n.props['aria-label']==='Retirer le passager 2')[0].props.onClick();h.render();h.submit();
 assert.deepEqual(h.loadings.at(-1),{pilotKg:75,equipmentKg:8,passengerCount:1});assert.equal(h.exported.at(-1)[1].sex,'');
 const before=h.exported.length;mass('Pilote (kg)').props.onChange({target:{value:''}});h.render();h.submit();assert.equal(h.exported.length,before);
 assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('Pilote')));
});

test('closing/reopening the listing restores session rows, edited pilot/equipment and invalid weight drafts',t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),data=new Map();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;});
 const h=harness(t,{draftKey:'navigation-test'}),mass=label=>h.all(n=>n.type==='input'&&n.props['aria-label']===label)[0];
 h.change(0,'select','F');editWeight(h,'83,5');
 mass('Pilote (kg)').props.onChange({target:{value:'74'}});h.render();mass('Équipement (kg)').props.onChange({target:{value:'9'}});h.render();
 h.all(n=>n.type==='button'&&n.props.children==='Annuler')[0].props.onClick();h.remount();
 assert.equal(weightInput(h).props.value,'83,5');assert.equal(mass('Pilote (kg)').props.value,'74');assert.equal(mass('Équipement (kg)').props.value,'9');
 h.submit();assert.equal(h.exported.at(-1)[0].customWeightKg,83.5);
 editWeight(h,'');h.remount();assert.equal(weightInput(h).props.value,'');const before=h.exported.length;h.submit();assert.equal(h.exported.length,before);
});
