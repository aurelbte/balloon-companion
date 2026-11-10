import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as passengers from '../lib/moroccoPassengers.ts';
const require=createRequire(import.meta.url);
function harness(t){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{}}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;});
  const slots=[];let cursor=0;const effects=[];const exported=[];let cancelled=0;let shown=0;let tree;
  const react={useId:()=> 'passenger-test',useRef:initial=>slots[cursor++]??=( {current:initial} ),useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useEffect(fn){const i=cursor++;if(!slots[i]){slots[i]={};effects.push(fn);}}};
  const mocks={react,'react-dom':{createPortal:node=>node},'../lib/moroccoPassengers':passengers};
  const js=ts.transpileModule(readFileSync(new URL('./MoroccoPassengerDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',js)(id=>id in mocks?mocks[id]:require(id),exports);
  const walk=(n,p,out=[])=>{if(n&&typeof n==='object'){if(p(n))out.push(n);for(const c of [n.props?.children].flat(Infinity))walk(c,p,out);}return out;};
  const render=()=>{cursor=0;tree=exports.default({date:'06/11/2026',onCancel:()=>cancelled++,onExport:rows=>exported.push(rows)});tree.props.ref.current={showModal(){shown++;}};while(effects.length)effects.shift()();return tree;};
  const all=p=>walk(tree,p);const row=i=>all(n=>n.type==='fieldset')[i];
  const change=(i,type,value)=>{const field=walk(row(i),n=>n.type===type)[0];field.props.onChange({target:{value}});render();};
  const submit=()=>{all(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});render();};
  render();return{all,row,change,submit,render,exported,get cancelled(){return cancelled;},get shown(){return shown;},get tree(){return tree;}};
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
test('invalid custom weight prevents export; clearing and leaving the field restores automatic weight',t=>{
  const h=harness(t);h.change(0,'select','H');
  for(const raw of ['0','-5','abc']){editWeight(h,raw);h.submit();assert.equal(h.exported.length,0);assert.ok(h.all(n=>n.props?.role==='alert').some(n=>n.props.children.includes('poids personnalisé')));}
  editWeight(h,'');weightInput(h).props.onBlur();h.render();assert.equal(weightInput(h).props.value,'92');h.submit();assert.equal(h.exported.length,1);
});
