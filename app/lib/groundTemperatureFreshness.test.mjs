import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {GROUND_TEMPERATURE_TTL_MS as TTL, GROUND_TEMPERATURE_PROVIDER_ID as ID, usableGroundTemperature, groundTemperatureRequestKey, OpenMeteoGroundTemperatureProvider, canFetchGroundTemperature} from './loadPerformance/groundTemperatureProvider.ts';
import {buildLoadCalculationInput} from './loadPerformance/balloonInput.ts';
const now=Date.parse('2026-09-18T08:00:00Z');
const request={latitude:48,longitude:2,dateTime:'2026-09-20T08:00:00Z',provider:ID};
const data=(age=0)=>({temperatureC:12,sourceModel:'Open-Meteo',forecastRun:'Non communiqué par Open-Meteo',validTime:request.dateTime,forecastOffsetMinutes:0,provider:'Open-Meteo',fetchedAt:new Date(now-age).toISOString(),requestIdentity:{...request}});
function env(t, clock=()=>now){
 const values=new Map(), win=new EventTarget(), doc=new EventTarget();doc.visibilityState='visible';
 win.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 for(const [key,value] of [['window',win],['document',doc],['navigator',{onLine:true}]]){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
 }
 let calls=0, network=()=>reply();
 t.mock.method(globalThis,'fetch',async (...args)=>{calls++;return network(...args);});
 function reply(overrides={}){const d=data();return new Response(JSON.stringify({ok:true,...d,requestedTime:request.dateTime,offsetMinutes:0,fetchedAt:new Date(clock()).toISOString(),...overrides}));}
 const base='balloon-companion:ground-temperature:v1:'+groundTemperatureRequestKey(request), pointer=base+':run:'+data().forecastRun;
 return {values,base,pointer,win,doc,reply,get calls(){return calls;},network(fn){network=fn;},cache(value){values.set(base+':latest',pointer);values.set(pointer,typeof value==='string'?value:JSON.stringify(value));}};
}
for(const [label,age,fresh] of [['under',TTL-1,true],['equal',TTL,true],['over',TTL+1,false],['future',-1000,false]])test(`B4 age ${label} TTL`,()=>{assert.equal(Boolean(usableGroundTemperature(data(age),request,now)),fresh);});
for(const [label,changes] of [['missing fetchedAt',{fetchedAt:undefined}],['invalid fetchedAt',{fetchedAt:'no-date'}],['invalid validTime',{validTime:'no-date'}],['invalid calendar',{validTime:'2026-02-30T08:00:00Z'}],['NaN',{temperatureC:NaN}],['Infinity',{temperatureC:Infinity}],['string',{temperatureC:'12'}],['null',{temperatureC:null}],['offset',{forecastOffsetMinutes:1}],['wrong period',{validTime:'2026-09-21T08:00:00Z',forecastOffsetMinutes:1440}],['source',{sourceModel:'other'}],['provider',{provider:'other'}],['missing identity',{requestIdentity:undefined}]])test(`B4 gate rejects ${label}`,()=>{assert.equal(usableGroundTemperature({...data(),...changes},request,now),null);});
for(const changes of [{latitude:49},{longitude:3},{dateTime:'2026-09-21T08:00:00Z'},{dateTime:'2026-09-20T09:00:00Z'},{provider:'other'}])test(`B4 identity ${JSON.stringify(changes)}`,()=>{assert.equal(usableGroundTemperature(data(),{...request,...changes},now),null);});
test('B4 fresh cache: no network',async t=>{const e=env(t);e.cache(data());assert.equal((await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'arome'})).temperatureC,12);assert.equal(e.calls,0);});
for(const [label,value] of [['stale',data(TTL+1)],['corrupt','{bad'],['invalid structure',{}],['missing timestamp',{...data(),fetchedAt:undefined}],['wrong identity',{...data(),requestIdentity:{...request,longitude:9}}]])test(`B4 ${label} cache fetches fresh online`,async t=>{const e=env(t);e.cache(value);e.network(()=>e.reply({temperatureC:22,fetchedAt:new Date(now).toISOString()}));assert.equal((await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'})).temperatureC,22);assert.equal(e.calls,1);});
test('B4 pointer must match request and run',async t=>{const e=env(t);e.cache(data());e.values.set(e.base+':latest','foreign');e.values.set('foreign',JSON.stringify(data()));await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'});assert.equal(e.calls,1);e.values.set(e.base+':latest',e.base+':run:wrong');e.values.set(e.base+':run:wrong',JSON.stringify(data()));await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'});assert.equal(e.calls,2);});
for(const cached of [false,true])test(`B4 offline ${cached?'stale':'absent'}: unavailable without network`,async t=>{const e=env(t);if(cached)e.cache(data(TTL+1));navigator.onLine=false;await assert.rejects(new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'}),{name:'GROUND_TEMPERATURE_UNAVAILABLE_OFFLINE'});assert.equal(e.calls,0);});
test('B4 network error never falls back to stale',async t=>{const e=env(t);e.cache(data(TTL+1));e.network(()=>{throw Error('network');});await assert.rejects(new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'}),/network/);});
for(const changes of [{temperatureC:null},{temperatureC:'12'},{fetchedAt:undefined},{fetchedAt:'invalid'},{fetchedAt:new Date(now+1).toISOString()},{validTime:'invalid'},{requestedTime:'other'},{offsetMinutes:10},{provider:'other'}])test(`B4 invalid network ${JSON.stringify(changes)} not used or cached`,async t=>{const e=env(t);e.cache(data(TTL+1));const before=[...e.values];e.network(()=>e.reply(changes));await assert.rejects(new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'}),{name:'INVALID_OPEN_METEO_RESPONSE'});assert.deepEqual([...e.values],before);});
for(const changes of [{latitude:49},{longitude:3},{dateTime:'2026-09-21T08:00:00Z'},{dateTime:'2026-09-20T09:00:00Z'}])test(`B4 different request ${JSON.stringify(changes)} bypasses old cache`,async t=>{const e=env(t);e.cache(data());const target={...request,...changes};e.network(()=>e.reply({requestedTime:target.dateTime,validTime:target.dateTime}));await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...target,weatherModel:'ignored'});assert.equal(e.calls,1);});

// Execute the actual /map temperature effect and input expressions, not a copied implementation.
const source=readFileSync(new URL('../map/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect;const expressions={};
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('new OpenMeteoGroundTemperatureProvider()'))effect=node.arguments[0].getText(ast);if(ts.isVariableDeclaration(node)&&['groundTemperature','loadInput'].includes(node.name.getText(ast)))expressions[node.name.getText(ast)]=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
function execute(text,bindings){const code=ts.transpileModule(`const result=(${text});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(bindings),code+'\nreturn result;')(...Object.values(bindings));}
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function mount(e){let state=null,pending=null,error=null;const config={request:{launchSite:request,launchDateTimeIso:request.dateTime}};
 const cleanup=execute(effect,{window:e.win,document:e.doc,navigator:globalThis.navigator,config,preparation:null,canFetchGroundTemperature,GROUND_TEMPERATURE_PROVIDER_ID:ID,GROUND_TEMPERATURE_TTL_MS:TTL,groundTemperatureRequestKey,OpenMeteoGroundTemperatureProvider,usableGroundTemperature,setGroundTemperatureState:v=>{state=v;},setGroundTemperaturePendingKey:v=>{pending=v;},setGroundTemperatureErrorCode:v=>{error=v;}})();
 return {cleanup,get pending(){return pending;},get error(){return error;},input(){const groundTemperature=execute(expressions.groundTemperature,{groundTemperatureRequest:request,groundTemperatureState:state,groundTemperatureKey:groundTemperatureRequestKey(request),usableGroundTemperature});return execute(expressions.loadInput,{buildLoadCalculationInput,selectedBalloon:undefined,preparation:null,config,launchElevationMslM:100,plannedMaximumAltitudeMslM:500,groundTemperature});}};
}
for(const outcome of ['success','error','offline'])test(`B4 map memory expiry without remount: ${outcome}`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now});const e=env(t,()=>Date.now());const page=mount(e);t.after(page.cleanup);await flush();assert.equal(page.input().groundTemperature.temperatureC,12);
 t.mock.timers.tick(TTL);assert.equal(page.input().groundTemperature.temperatureC,12);
 if(outcome==='offline')navigator.onLine=false;
 e.network(()=>{if(outcome==='error')throw Error('network');return e.reply({temperatureC:24});});
 t.mock.timers.tick(1);assert.equal(page.input().groundTemperature,undefined);await flush();
 if(outcome==='success'){assert.equal(page.input().groundTemperature.temperatureC,24);assert.equal(e.calls,2);}else{assert.equal(page.input().groundTemperature,undefined);assert.ok(page.error);if(outcome==='offline')assert.equal(e.calls,1);}
});
test('B4 map calculation gate rejects invalid or expired in-memory values',()=>{
 for(const value of [data(TTL+1),{...data(),temperatureC:'12'},{...data(),fetchedAt:undefined}]){
  const groundTemperature=execute(expressions.groundTemperature,{groundTemperatureRequest:request,groundTemperatureState:{key:groundTemperatureRequestKey(request),value},groundTemperatureKey:groundTemperatureRequestKey(request),usableGroundTemperature:(v,r)=>usableGroundTemperature(v,r,now)});
  assert.equal(buildLoadCalculationInput({groundTemperature:groundTemperature??undefined}).groundTemperature,undefined);
 }
});
test('B4 map resume checks expiry even when background timer was suspended',async t=>{
 let time=now;const e=env(t,()=>time);t.mock.method(Date,'now',()=>time);e.cache(data());const page=mount(e);t.after(page.cleanup);await flush();assert.ok(page.input().groundTemperature);
 time+=TTL+1;navigator.onLine=false;e.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(page.input().groundTemperature,undefined);
 navigator.onLine=true;e.win.dispatchEvent(new Event('online'));await flush();assert.ok(page.input().groundTemperature);assert.equal(e.calls,1);
});
test('B4 UI exposes source, forecast and retrieval date or unavailable calculation',()=>{assert.match(source,/groundTemperature\.provider.*Prévision.*groundTemperature\.validTime.*Récupérée.*groundTemperature\.fetchedAt/);assert.match(source,/Température actuelle indisponible pour le calcul de charge/);});

test('B4 invalid network cannot overwrite a healthy entry behind an invalid pointer',async t=>{
 const e=env(t);e.cache(data());e.values.set(e.base+':latest','invalid-pointer');const before=[...e.values];
 e.network(()=>e.reply({temperatureC:'bad'}));
 await assert.rejects(new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'}));
 assert.deepEqual([...e.values],before);
});
test('B4 fresh offline cache remains usable within TTL',async t=>{
 const e=env(t);e.cache(data(TTL));navigator.onLine=false;
 assert.ok(await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'}));assert.equal(e.calls,0);
});
test('B4 unreadable cache and optional cache write failure still permit validated live data',async t=>{
 const e=env(t);e.win.localStorage.getItem=()=>{throw Error('SecurityError');};e.win.localStorage.setItem=()=>{throw Error('QuotaExceededError');};
 assert.equal((await new OpenMeteoGroundTemperatureProvider(()=>now).getGroundTemperature({...request,weatherModel:'ignored'})).temperatureC,12);
});
