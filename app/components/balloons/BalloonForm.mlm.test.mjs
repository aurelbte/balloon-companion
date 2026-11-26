import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as catalog from '../../lib/balloonCatalog.ts';
import * as policy from '../../lib/balloonFormPolicy.ts';
import * as hydration from '../../lib/balloonFormHydration.ts';
import * as balloons from '../../lib/balloons.ts';
import * as mtom from '../../lib/loadPerformance/modelParameters/mtomCatalog.ts';
import * as mlm from '../../lib/balloonMinimumLandingMass.ts';
import {mlmBalloon,withConfirmedMlm} from '../../lib/balloonMinimumLandingMass.fixtures.mjs';
function nodes(t){return Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];}
const text=t=>nodes(t).flatMap(n=>typeof n.props?.children==='string'?[n.props.children]:[]).join(' ');
function harness(balloon){
 const slots=[];let cursor=0,effects=[],tree;const saved=[];
 const react={useRef(v){const i=cursor++;return slots[i]??(slots[i]={current:v});},useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old[j])){slots[i]=deps;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props});const mocks={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},'../../lib/balloonCatalog':catalog,'../../lib/balloonFormPolicy':policy,'../../lib/balloonFormHydration':hydration,'../../lib/balloons':balloons,'../../lib/loadPerformance/modelParameters/mtomCatalog':mtom,'../../lib/balloonMinimumLandingMass':mlm,'../../more/More.module.css':{default:{}}};
 const js=ts.transpileModule(readFileSync(new URL('./BalloonForm.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={};new Function('require','exports',js)(id=>{assert.ok(id in mocks,id);return mocks[id];},exports);
 const render=()=>{cursor=0;effects=[];tree=exports.default({balloon,submitLabel:'Enregistrer',onSubmit:v=>saved.push(v),onCancel(){}});effects.forEach(fn=>fn());return tree;};
 render();render();
 return{saved,render,field(label,type='input'){const parent=nodes(tree).find(n=>n.type==='label'&&text(n).includes(label));assert.ok(parent,label);return nodes(parent).find(n=>n.type===type);},submit(){tree.props.onSubmit({preventDefault(){}});render();}};
}
test('profile proposes 1247, saves its reference and explicit confirmation; overrides persist and configuration changes revoke review',()=>{
 const b=mlmBalloon(),h=harness(b);
 assert.equal(h.field('Masse minimale à l’atterrissage (kg)').props.value,'1247');
 assert.equal(h.field('J’ai vérifié cette masse minimale').props.checked,false);
 h.field('J’ai vérifié cette masse minimale').props.onChange({target:{checked:true}});h.render();h.submit();
 assert.equal(mlm.balloonMinimumLandingMass(balloons.createBalloon(h.saved.at(-1),b.id)).confirmed,true);
 h.field('Masse minimale à l’atterrissage (kg)').props.onChange({target:{value:'1250'}});h.render();assert.equal(h.field('J’ai vérifié cette masse minimale').props.checked,false);
 h.field('J’ai vérifié cette masse minimale').props.onChange({target:{checked:true}});h.render();h.submit();assert.equal(h.saved.at(-1).minimumLandingMass.valueKg,1250);
 h.field('Nacelle').props.onChange({target:{value:'301'}});h.render();h.render();h.submit();assert.equal(h.saved.at(-1).minimumLandingMass.confirmed,false);
});
test('reopening retains reviewed profile; changing reference invalidates; invalid minimum blocks save',()=>{
 const b=withConfirmedMlm(mlmBalloon()),h=harness(b);assert.equal(h.field('J’ai vérifié cette masse minimale').props.checked,true);
 h.field('Référence de la vérification MLM').props.onChange({target:{value:'Another edition'}});h.render();h.submit();assert.equal(h.saved.at(-1).minimumLandingMass.confirmed,false);
 const count=h.saved.length;h.field('Masse minimale à l’atterrissage (kg)').props.onChange({target:{value:'0'}});h.render();h.submit();assert.equal(h.saved.length,count);
});
