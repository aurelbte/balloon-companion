import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parsePowerLines,getPowerLineQueryBounds,powerLineBoundsContain,validatePowerLineResult} from './powerLines.ts';
import {PowerLineMemoryStore,PowerLineRuntime,powerLineStatusLabel} from './powerLinesRuntime.ts';
const viewport={west:2,south:50,east:2.1,north:50.1};
const elsewhere={west:4,south:48,east:4.1,north:48.1};
const stamp='2026-09-18T12:00:00.000Z';
const way={id:1,tags:{power:'line'},geometry:[{lon:2,lat:50},{lon:2.1,lat:50.1}]};
const envelope=(bounds,elements=[way],extra={})=>({...parsePowerLines({elements,...extra}),bounds,fetchedAt:stamp});
const response=(body,ok=true)=>({ok,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(fetcher){let state;const states=[];const store=new PowerLineMemoryStore(fetcher);const runtime=new PowerLineRuntime(value=>{state=value;states.push(value);},store);return {runtime,store,states,get state(){return state;}};}
for(const [elements,status] of [[[way],'AVAILABLE'],[[],'EMPTY_CONFIRMED']])test(`validated result => ${status}`,async()=>{
 const bounds=getPowerLineQueryBounds(viewport);const h=setup(async()=>response(envelope(bounds,elements)));
 await h.runtime.update(viewport,true);assert.equal(h.state.status,status);assert.equal(h.state.covered,true);assert.equal(h.state.fetchedAt,stamp);
 await h.runtime.update(viewport,false);assert.equal(h.state.status,status);assert.equal(h.state.fetchedAt,stamp);assert.match(powerLineStatusLabel(h.state),/Hors ligne/);
});
test('missing/invalid elements cannot become validated empty',()=>{
 for(const raw of [{},{elements:null},{elements:{}},null])assert.throws(()=>parsePowerLines(raw));
});
test('remark/error preserves partial valid lines but never confirms empty',async()=>{
 for(const extra of [{remark:'runtime error: timeout'},{error:'failed'}]){
 const bounds=getPowerLineQueryBounds(viewport),payload=envelope(bounds,[],extra);
 assert.equal(payload.complete,false);assert.equal(payload.emptyConfirmed,false);
 const h=setup(async()=>response(payload));await h.runtime.update(viewport,true);
 assert.equal(h.state.status,'INCOMPLETE');assert.equal(h.state.covered,false);assert.equal(h.store.results.size,0);
 }
});
test('invalid coordinates, missing geometry/id/tag are counted, no complete coverage',async()=>{
 for(const bad of [{...way,id:undefined},{...way,geometry:[{lon:NaN,lat:50},{lon:2,lat:51}]},{...way,geometry:[{lon:2,lat:Infinity},{lon:2,lat:51}]},{...way,geometry:[{lon:'2',lat:50},{lon:2,lat:51}]},{...way,geometry:[]},{...way,tags:undefined}]){
 const payload=envelope(getPowerLineQueryBounds(viewport),[way,bad]);assert.equal(payload.features.length,1);assert.equal(payload.rejectedElements,1);assert.equal(payload.complete,false);
 const h=setup(async()=>response(payload));await h.runtime.update(viewport,true);assert.equal(h.state.status,'INCOMPLETE');assert.equal(h.state.covered,false);assert.equal(h.state.data.features.length,1);
 }
});
for(const kind of ['http','network','timeout','json','malformed'])test(`${kind} is unavailable, evicted and retryable`,async()=>{
 let calls=0;const bounds=getPowerLineQueryBounds(viewport);const h=setup(async()=>{
 if(++calls>1)return response(envelope(bounds,[]));
 if(kind==='network')throw new TypeError('network');if(kind==='timeout')throw new DOMException('timeout','TimeoutError');
 if(kind==='json')return {ok:true,json:async()=>{throw new SyntaxError('JSON');}};
 return response(kind==='malformed'?{}:null,kind!=='http');
 });
 await h.runtime.update(viewport,true);assert.equal(h.state.status,'UNAVAILABLE');assert.equal(h.store.results.size,0);
 await h.runtime.update(viewport,true);assert.equal(calls,2);assert.equal(h.state.status,'EMPTY_CONFIRMED');
});
test('client validation rejects wrong bounds, date, flags and geometry',()=>{
 const bounds=getPowerLineQueryBounds(viewport),valid=envelope(bounds);
 for(const bad of [{...valid,bounds:elsewhere},{...valid,fetchedAt:'invalid'},{...valid,emptyConfirmed:true},{...valid,complete:true,rejectedElements:1},{...valid,features:[{...valid.features[0],id:undefined}]},{...valid,features:[{...valid.features[0],geometry:{type:'LineString',coordinates:[[NaN,50],[2,51]]}}]}])assert.throws(()=>validatePowerLineResult(bad,bounds));
});
test('failure in a new viewport retains old features/date without validating new coverage',async()=>{
 let calls=0;const pending=deferred();const h=setup(async()=>++calls===1?response(envelope(getPowerLineQueryBounds(viewport))):pending.promise);
 await h.runtime.update(viewport,true);const update=h.runtime.update(elsewhere,true);
 assert.equal(h.state.status,'UNKNOWN_COVERAGE');assert.equal(h.state.loading,true);assert.equal(h.state.covered,false);assert.equal(h.state.data.features.length,1);
 pending.reject(new TypeError('offline'));await update;
 assert.equal(h.state.status,'UNKNOWN_COVERAGE');assert.equal(h.state.fetchedAt,stamp);assert.equal(h.state.data.features.length,1);assert.match(powerLineStatusLabel(h.state),/conservées/);
 await h.runtime.update(elsewhere,false);assert.equal(h.state.offline,true);assert.equal(h.state.fetchedAt,stamp);assert.match(powerLineStatusLabel(h.state),/Hors ligne/);
});
test('offline without cache is unavailable and does not request',async()=>{
 const h=setup(async()=>{throw new Error('must not fetch');});await h.runtime.update(viewport,false);assert.equal(h.state.status,'UNAVAILABLE');assert.equal(h.state.retained,false);assert.equal(h.state.fetchedAt,undefined);
});
test('capped query with valid empty does not confirm whole viewport',async()=>{
 const wide={west:-5,south:42,east:9,north:51};const bounds=getPowerLineQueryBounds(wide);assert.equal(powerLineBoundsContain(bounds,wide),false);
 const h=setup(async()=>response(envelope(bounds,[])));await h.runtime.update(wide,true);assert.equal(h.state.status,'UNKNOWN_COVERAGE');assert.equal(h.state.covered,false);
});
test('out-of-order responses cannot update the wrong viewport',async()=>{
 const a=deferred(),b=deferred();let calls=0;const h=setup(()=>++calls===1?a.promise:b.promise);
 const first=h.runtime.update(viewport,true),second=h.runtime.update(elsewhere,true);
 b.resolve(response(envelope(getPowerLineQueryBounds(elsewhere),[])));await second;const accepted=h.state;
 a.resolve(response(envelope(getPowerLineQueryBounds(viewport))));await first;assert.equal(h.state,accepted);assert.equal(h.state.status,'EMPTY_CONFIRMED');
});
test('identical simultaneous queries deduplicate; stopped runtime rejects callbacks and reactivation rechecks',async()=>{
 const pending=deferred();let calls=0;const h=setup(()=>{calls++;return pending.promise;});
 const a=h.runtime.update(viewport,true),b=h.runtime.update(viewport,true);assert.equal(calls,1);
 h.runtime.stop();const previous=h.state;pending.resolve(response(envelope(getPowerLineQueryBounds(viewport))));await Promise.all([a,b]);assert.equal(h.state,previous);
 await h.runtime.update(elsewhere,false);assert.equal(h.state.status,'UNKNOWN_COVERAGE');assert.equal(h.state.covered,false);
 await h.runtime.update(viewport,false);assert.equal(h.state.status,'AVAILABLE');
});
test('partial retry can complete; partial features do not contradict a later validated empty',async()=>{
 let calls=0;const bounds=getPowerLineQueryBounds(viewport);const h=setup(async()=>response(++calls===1?envelope(bounds,[way],{remark:'partial'}):envelope(bounds,[])));
 await h.runtime.update(viewport,true);assert.equal(h.state.status,'INCOMPLETE');await h.runtime.update(viewport,true);assert.equal(calls,2);assert.equal(h.state.status,'EMPTY_CONFIRMED');assert.equal(h.state.data.features.length,0);
});
test('UI is gated by enabled option; deactivation invalidates runtime; no absolute absence claim',()=>{
 const map=readFileSync(new URL('../components/flight/FlightMap.tsx',import.meta.url),'utf8');
 assert.match(map,/showPowerLines && powerLineState && powerLineStatusLabel/);assert.match(map,/if \(!showPowerLines\) powerLineRuntimeRef.current\?\.stop/);
 assert.doesNotMatch(readFileSync(new URL('./powerLinesRuntime.ts',import.meta.url),'utf8'),/Aucune ligne électrique/);
});
test('actual route handles success, invalid/partial provider and exceptions with fake fetch only',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const raw=readFileSync(new URL('../api/osm/power-lines/route.ts',import.meta.url),'utf8').replace(/import\s*\{[\s\S]*?\}\s*from\s*[^;]+;/,'');
 const code=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','buildPowerLinesQuery','parsePowerLines',code)(exports,()=> 'simulated query',parsePowerLines);
 for(const [body,expected]of [[{elements:[way]},200],[{elements:[]},200],[{},503],[{elements:[],remark:'timeout'},200]]){
 globalThis.fetch=async()=>response(body);const result=await exports.GET(new Request('http://localhost/api/osm/power-lines?west=2&south=50&east=2.1&north=50.1'));assert.equal(result.status,expected);
 const payload=await result.json();if(body.remark){assert.equal(payload.emptyConfirmed,false);assert.equal(payload.complete,false);assert.equal(result.headers.get('Cache-Control'),'no-store');}else if(expected===200)assert.ok(Number.isFinite(Date.parse(payload.fetchedAt)));
 }
 for(const fetcher of [async()=>response(null,false),async()=>{throw new DOMException('timeout','TimeoutError');},async()=>({ok:true,json:async()=>{throw new SyntaxError('JSON');}})]){
 globalThis.fetch=fetcher;const result=await exports.GET(new Request('http://localhost/api/osm/power-lines?west=2&south=50&east=2.1&north=50.1'));assert.equal(result.status,503);
 }
});

test('failed refresh cannot alter successful cache timestamp or features',async()=>{
 const bounds=getPowerLineQueryBounds(viewport);let calls=0;
 const store=new PowerLineMemoryStore(async()=>{if(++calls===1)return response(envelope(bounds));throw new TypeError('failed refresh');});
 await store.load(bounds);await assert.rejects(()=>store.load(bounds));
 const result=[...store.results.values()][0];assert.equal(result.fetchedAt,stamp);assert.equal(result.features.length,1);
});
test('validated partial references survive remount and remain incomplete offline',async()=>{
 const store=new PowerLineMemoryStore(async()=>response(envelope(getPowerLineQueryBounds(viewport),[way],{remark:'partial'})));
 const first=new PowerLineRuntime(()=>{},store);await first.update(viewport,true);first.stop();
 let state;const next=new PowerLineRuntime(value=>state=value,store);await next.update(viewport,false);
 assert.equal(state.status,'INCOMPLETE');assert.equal(state.covered,false);assert.equal(state.data.features.length,1);assert.equal(state.fetchedAt,stamp);assert.match(powerLineStatusLabel(state),/Hors ligne/);
});

const conflictA={west:2,south:50,east:2.1,north:50.1};
const conflictB={west:2.08,south:50,east:2.18,north:50.1};
const conflictIntersection={west:2.09,south:50.02,east:2.095,north:50.025};
const conflictWay={id:40,tags:{power:'line'},geometry:[{lon:2.091,lat:50.021},{lon:2.094,lat:50.024}]};
for(const area of [conflictA,conflictIntersection])test(`older validated empty never overrides relevant partial line in ${area===conflictA?'A':'intersection'}`,async()=>{
 let calls=0;const h=setup(async url=>{
 const params=new URL(url,'http://localhost').searchParams;
 const bounds=Object.fromEntries(['west','south','east','north'].map(key=>[key,Number(params.get(key))]));
 return response({...parsePowerLines(++calls===1?{elements:[]}:{elements:[conflictWay],remark:'runtime error: incomplete'}),bounds,fetchedAt:calls===1?stamp:'2026-09-18T12:10:00Z'});
 });
 await h.runtime.update(conflictA,true);assert.equal(h.state.status,'EMPTY_CONFIRMED');
 await h.runtime.update(conflictB,true);assert.equal(h.state.status,'INCOMPLETE');
 await h.runtime.update(area,true);assert.equal(h.state.status,'INCOMPLETE');assert.equal(h.state.covered,false);assert.equal(h.state.data.features.length,1);
 const before=h.state.fetchedAt;assert.equal(before,stamp);await h.runtime.update(area,false);
 assert.equal(h.state.status,'INCOMPLETE');assert.equal(h.state.data.features.length,1);assert.equal(h.state.fetchedAt,before);
});
test('older encompassing complete empty cannot suppress a newer contained partial reference',async()=>{
 const large=getPowerLineQueryBounds(conflictA),small=conflictIntersection;
 const store=new PowerLineMemoryStore(async url=>{
 const params=new URL(url,'http://localhost').searchParams;
 const bounds=Object.fromEntries(['west','south','east','north'].map(key=>[key,Number(params.get(key))]));
 const full=bounds.west===large.west;
 return response({...parsePowerLines(full?{elements:[]}:{elements:[conflictWay],remark:'incomplete'}),bounds,fetchedAt:full?stamp:'2026-09-18T12:10:00Z'});
 });
 await store.load(small);await store.load(large);
 let state;const runtime=new PowerLineRuntime(value=>state=value,store);await runtime.update(small,false);
 assert.equal(state.status,'INCOMPLETE');assert.equal(state.covered,false);assert.equal(state.data.features.length,1);
});
for(const elements of [[{id:12,tags:{power:'minor_line'},geometry:way.geometry}],[{id:12,tags:{power:'cable'}}],[{...way,geometry:[]}],[{...way,geometry:[{lon:NaN,lat:50},{lon:2,lat:51}]}]])test(`nonempty filtered/rejected response cannot confirm empty: ${elements[0].tags?.power}/${elements[0].geometry?.length}`,async()=>{
 const payload=envelope(getPowerLineQueryBounds(viewport),elements);
 assert.equal(payload.emptyConfirmed,false);assert.equal(payload.complete,false);assert.equal(payload.features.length,0);
 const h=setup(async()=>response(payload));await h.runtime.update(viewport,true);
 assert.equal(h.state.status,'INCOMPLETE');assert.equal(h.state.covered,false);assert.equal(h.state.data.features.length,0);
});
test('really empty provider response still confirms its validated coverage',async()=>{
 const payload=envelope(getPowerLineQueryBounds(viewport),[]);assert.equal(payload.emptyConfirmed,true);assert.equal(payload.complete,true);
 const h=setup(async()=>response(payload));await h.runtime.update(viewport,true);assert.equal(h.state.status,'EMPTY_CONFIRMED');assert.equal(h.state.covered,true);
});
test('EMPTY_CONFIRMED globally implies no pertinent known line, including crossing segments',async()=>{
 const {powerLineFeatureIntersectsViewport}=await import('./powerLinesRuntime.ts');
 const area={west:2,south:50,east:2.1,north:50.1},bounds=getPowerLineQueryBounds(area);
 for(const [line,expected] of [
 [{...way,geometry:[{lon:1.9,lat:50.05},{lon:2.2,lat:50.05}]},'AVAILABLE'],
 [{...way,geometry:[{lon:4,lat:48},{lon:4.1,lat:48.1}]},'EMPTY_CONFIRMED'],
 ]){
 let calls=0;const store=new PowerLineMemoryStore(async()=>response(envelope(++calls===1?bounds:getPowerLineQueryBounds(elsewhere),calls===1?[]:[line])));
 await store.load(bounds);await store.load(getPowerLineQueryBounds(elsewhere));
 let state;const runtime=new PowerLineRuntime(value=>state=value,store);await runtime.update(area,false);assert.equal(state.status,expected);
 if(state.status==='EMPTY_CONFIRMED')assert.equal(state.data.features.filter(feature=>powerLineFeatureIntersectsViewport(feature,area)).length,0);
 }
});
