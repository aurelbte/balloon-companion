import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createTrajectoryAnalysisKey, createTrajectoryPreparationKey, selectedProjectionTraces, mergeProjectionResults } from './analysisState.ts';
const source=readFileSync(new URL('../../map/page.tsx',import.meta.url),'utf8');
const start=source.indexOf('  useEffect(() => {\n    if (!ready || !config) return;');
const end=source.indexOf('  }, [config, ready, selectedAltitudes, selectedModels, weatherRefreshToken]);',start);
assert.ok(start>=0 && end>start);
const effect=ts.transpileModule(source.slice(start,end)+'  }, [config, ready, selectedAltitudes, selectedModels, weatherRefreshToken]);', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const request={version:2,launchSite:{latitude:50,longitude:3,name:'Terrain',altitudeMslM:100},launchDateTimeIso:'2026-11-15T10:00:00Z',durationSeconds:3600,weatherModel:'a',altitudesAmslM:[1000],primaryAltitudeAmslM:1000,climbRateMps:2,descentRateMps:2};
const trace=(model='a',altitude=1000,tag='old')=>({traceId:`${model}:${altitude}`,model:{id:model},altitudeKey:String(altitude),altitudeAmslM:altitude,projection:{tag,points:[]}});
function harness(){
 let traces=[trace()],visible=['a:1000'],notice=null,loading=false,cleanup;
 const jobs=[],calls=[],saves=[];
 const env={ready:true,config:{request},selectedModels:['a'],selectedAltitudes:[1000],weatherRefreshToken:0,
  displayedPreparationRef:{current:createTrajectoryPreparationKey(request)},compatibleTracesRef:{current:traces},
  requestAbortRef:{current:null},signatureRef:{current:createTrajectoryAnalysisKey(request,['a'],[1000])},desiredSignatureRef:{current:''},displayedSignatureRef:{current:''},analysisBusyRef:{current:false},
  navigator:{onLine:true},window:{setTimeout:fn=>{jobs.push(fn);return jobs.length;},clearTimeout:()=>{}},
  getRuntimeDataScope:()=> 'scope',getRuntimeDataScopeGeneration:()=>1,
  setTraces:value=>{traces=typeof value==='function'?value(traces):value;},setVisibleTraceIds:value=>{visible=typeof value==='function'?value(visible):value;},setFailures:()=>{},setLoading:v=>{loading=v;},setNotice:v=>{notice=v;},setExportIds:()=>{},
  createTrajectoryAnalysisKey,createTrajectoryPreparationKey,mergeProjectionResults,
  WEATHER_MODEL_REGISTRY:[{id:'a',supported:true,providerModelId:'a'},{id:'b',supported:true,providerModelId:'b'}],
  fetch:(_url,options)=>new Promise(resolve=>calls.push({request:JSON.parse(options.body),signal:options.signal,resolve:payload=>resolve({json:async()=>payload})})),
  archiveMoroccoCalculation:()=>{},moroccoCalculationIdentity:()=>{},loadWeatherAnalysis:()=>null,isUsableWeatherAnalysisCache:()=>false,rememberPreparationValue:()=>{},saveWeatherAnalysis:v=>saves.push(v),layers:{},
  useEffect:fn=>{cleanup=fn();},
 };
 const run=()=>new Function(...Object.keys(env),effect)(...Object.values(env));
 const select=(models,altitudes=[1000])=>{
  // Execute the actual handlers, including synchronous cancellation/pruning.
  const execute=(name,vars)=>{
   const a=source.indexOf(`  const ${name} = (`),b=source.indexOf('\n  };',a)+5;
   const body=ts.transpileModule(source.slice(a,b),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
   const deps={...env,...vars,selectedProjectionTraces,toggleSelection:({current,value})=>current.includes(value)?current.filter(x=>x!==value):[...current,value],ALTITUDE_OPTIONS:[1000,2000],setSelectedModels:v=>{env.selectedModels=v;},setSelectedAltitudes:v=>{env.selectedAltitudes=v;}};
   new Function(...Object.keys(deps),body+`; ${name}(value);`)(...Object.values(deps));
  };
  for(const value of [...new Set([...env.selectedModels,...models])])if(env.selectedModels.includes(value)!==models.includes(value))execute('toggleModel',{value});
  for(const value of [1000,2000])if(env.selectedAltitudes.includes(value)!==altitudes.includes(value))execute('toggleAltitude',{value});
  cleanup?.();run();
 };
 const launch=async()=>{const job=jobs.at(-1);assert.ok(job);const done=job();await Promise.resolve();return {done,calls:calls.slice()};};
 return {env,select,run,launch,calls,saves,get traces(){return traces;},get visible(){return visible;},get notice(){return notice;},get loading(){return loading;}};
}
const success=(altitudes=[1000],tag='new')=>({ok:true,layerProjections:altitudes.map(altitude=>trace('ignored',altitude,tag)),failures:[],weatherFetchedAt:'2026-11-15T09:00:00Z'});
const failure={ok:false,error:{code:'NETWORK_UNAVAILABLE',message:'Failure'}};
test('preparation identity excludes selections but includes every other request parameter',()=>{
 const key=createTrajectoryPreparationKey(request);
 assert.equal(createTrajectoryPreparationKey({...request,weatherModel:'b',altitudesAmslM:[2000]}),key);
 for(const change of [{durationSeconds:7200},{launchDateTimeIso:'later'},{climbRateMps:3},{descentRateMps:3},{primaryAltitudeAmslM:2000},{launchTimeZone:'Europe/Paris'},{launchSite:{...request.launchSite,altitudeMslM:200}}])assert.notEqual(createTrajectoryPreparationKey({...request,...change}),key);
});
test('adding a model keeps visible old data throughout loading and replaces results atomically',async()=>{
 const h=harness();h.select(['a','b']);assert.equal(h.traces[0].projection.tag,'old');assert.deepEqual(h.visible,['a:1000']);assert.equal(h.loading,true);
 const {done}=await h.launch();h.calls[0].resolve(success());await Promise.resolve();assert.equal(h.traces[0].projection.tag,'old');
 h.calls[1].resolve(success());await done;assert.deepEqual(h.traces.map(t=>t.traceId),['a:1000','b:1000']);assert.deepEqual(h.visible,['a:1000','b:1000']);
});
test('partial altitude failure preserves only the still-selected failed altitude',async()=>{
 const h=harness();h.env.compatibleTracesRef.current=[trace(),trace('a',2000)];h.select(['a'],[1000,2000]);
 const {done}=await h.launch();h.calls[0].resolve({...success([2000]),failures:[{altitudeKey:'1000',code:'MISSING'}]});await done;
 assert.equal(h.traces.find(t=>t.altitudeKey==='1000').projection.tag,'old');assert.equal(h.traces.find(t=>t.altitudeKey==='2000').projection.tag,'new');assert.match(h.notice,/incomplète.*conservées/);
});
test('rapid remove/re-add aborts stale responses and does not resurrect deselected traces on failure',async()=>{
 const h=harness();h.select(['a','b']);const first=await h.launch();const old=h.calls.slice();
 h.select(['b']);assert.deepEqual(h.traces,[]);assert.deepEqual(h.visible,[]);assert.ok(old.every(c=>c.signal.aborted));
 h.select(['a','b']);const latest=await h.launch();
 old.forEach(c=>c.resolve(success([1000],'obsolete')));await first.done;assert.deepEqual(h.traces,[]);
 h.calls.slice(old.length).forEach(c=>c.resolve(failure));await latest.done;assert.deepEqual(h.traces,[]);assert.equal(h.saves.length,0);
});
test('changed preparation resets immediately and cannot retain failed old projections; empty selection clears',async()=>{
 const h=harness();h.env.config={request:{...request,climbRateMps:4}};h.run();assert.deepEqual(h.traces,[]);assert.deepEqual(h.visible,[]);
 const {done}=await h.launch();h.calls[0].resolve(failure);await done;assert.deepEqual(h.traces,[]);
 h.select([]);assert.deepEqual(h.traces,[]);assert.deepEqual(h.visible,[]);assert.equal(h.loading,false);
});

test('adding an altitude keeps old ids; removing only one altitude preserves the other without resurrection',async()=>{
 const h=harness();h.select(['a'],[1000,2000]);assert.deepEqual(h.visible,['a:1000']);assert.equal(h.traces[0].projection.tag,'old');
 const {done}=await h.launch();h.calls[0].resolve(success([1000,2000]));await done;
 h.select(['a'],[2000]);assert.deepEqual(h.visible,['a:2000']);assert.deepEqual(h.traces.map(t=>t.altitudeKey),['2000']);
 const next=await h.launch();h.calls[1].resolve(failure);await next.done;
 assert.deepEqual(h.traces.map(t=>t.altitudeKey),['2000']);assert.match(h.notice,/incomplète.*conservées/);
});
test('successful missing results never leave unrelated old data visible',async()=>{
 const h=harness();h.select(['a','b']);const {done}=await h.launch();
 h.calls[0].resolve(success([]));h.calls[1].resolve(success([]));await done;
 assert.deepEqual(h.traces,[]);assert.deepEqual(h.visible,[]);
});
