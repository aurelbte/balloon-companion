import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpenMeteoWindProvider } from './weather/openMeteo/adapter.ts';
import { WEATHER_MODEL_REGISTRY } from './weather/models.ts';
import { createTrajectoryAnalysisKey } from './trajectory/analysisState.ts';
import { DEFAULT_ANALYSIS_LAYERS, saveFlightWeatherSnapshot, loadFlightWeatherSnapshot, saveWeatherAnalysis, loadWeatherAnalysis } from './trajectory/weatherAnalysisStorage.ts';
import { validateFlightWeather } from './flightWeatherValidation.ts';
import { classifyWeatherFreshness, ANALYSIS_POLICY } from './weather/weatherFreshness.ts';
import { savePreparationDraft } from './preparationDraftStorage.ts';
import { saveTrajectoryAnalysisRequest } from './trajectory/projectionStorage.ts';
import { refreshCurrentWeatherAnalysis } from './trajectory/refreshWeatherAnalysis.ts';
import { setRuntimeAuthSnapshot } from './auth/dataScopeRuntime.ts';
function fixture(){
 const source=readFileSync(new URL('./flightWeatherValidation.test.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function fixture()'),source.indexOf('\ntest('));
 return new Function('WEATHER_MODEL_REGISTRY','createTrajectoryAnalysisKey','DEFAULT_ANALYSIS_LAYERS',body+';return fixture();')(WEATHER_MODEL_REGISTRY,createTrajectoryAnalysisKey,DEFAULT_ANALYSIS_LAYERS);
}
let userSequence=0;
function env(t){
 const values=new Map(), storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const win=new EventTarget();win.localStorage=storage;win.sessionStorage=storage;
 for(const[key,value]of[['window',win],['localStorage',storage],['navigator',{onLine:true}]]){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
 }
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'weather-test-'+(++userSequence),email:'test@example.com'}});
 return {storage,values};
}
test('provider: récupération après await/validation, données invalides sans timestamp fiable',async t=>{
 const source=readFileSync(new URL('./weatherColumn.test.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function fixture()'),source.indexOf('\ntest('));
 const payload=new Function(body+';return fixture();')();
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-18T05:00Z')});
 let resolve,retrieved;
 const provider=new OpenMeteoWindProvider({fetchWindColumn:()=>new Promise(yes=>resolve=yes)},26,time=>retrieved=time);
 const pending=provider.prepareProjection({latitude:payload.latitude,longitude:payload.longitude,validAt:'2026-07-29T20:00Z',altitudeAmslM:100,weatherModel:'arome_seamless'});
 assert.equal(retrieved,undefined);t.mock.timers.tick(5000);resolve(payload);await pending;
 assert.equal(retrieved,'2026-09-18T05:00:05.000Z');
 let invalidTimestamp;
 const bad=new OpenMeteoWindProvider({fetchWindColumn:async()=>({})},26,time=>invalidTimestamp=time);
 await assert.rejects(bad.prepareProjection({latitude:50,longitude:3,validAt:'2026-07-29T20:00Z',altitudeAmslM:100,weatherModel:'arome_seamless'}));assert.equal(invalidTimestamp,undefined);
});
test('ancienne analyse UNKNOWN; nouveaux snapshots séparent échéance/calcul/récupération/run',()=>{
 const input=fixture();let result=validateFlightWeather(input);
 assert.equal(classifyWeatherFreshness(input.now,result.snapshot.weatherFetchedAt,ANALYSIS_POLICY),'UNKNOWN');
 const fetched=new Date(input.now-10*60_000).toISOString();input.analysis.traces[0].weatherFetchedAt=fetched;
 result=validateFlightWeather(input);assert.equal(result.snapshot.weatherFetchedAt,fetched);
 assert.equal(result.snapshot.forecastAtIso,input.request.launchDateTimeIso);assert.equal(result.snapshot.calculatedAtIso,input.analysis.traces[0].calculatedAtIso);
 assert.notEqual(result.snapshot.weatherFetchedAt,result.snapshot.calculatedAtIso);assert.equal(result.snapshot.modelRunAt,null);
 assert.equal(classifyWeatherFreshness(input.now,result.snapshot.weatherFetchedAt,ANALYSIS_POLICY),'FRESH');
});
test('lecture snapshot v1 historique conservée sans conversion en récupération',t=>{
 env(t);const input=fixture();const snapshot={...input.snapshot};delete snapshot.calculatedAtIso;delete snapshot.modelRunAt;
 assert.equal(saveFlightWeatherSnapshot(snapshot),true);assert.deepEqual(loadFlightWeatherSnapshot(),snapshot);
 assert.equal(classifyWeatherFreshness(input.now,loadFlightWeatherSnapshot().weatherFetchedAt,ANALYSIS_POLICY),'UNKNOWN');
 const next={...snapshot,weatherFetchedAt:new Date(input.now).toISOString(),calculatedAtIso:input.analysis.traces[0].calculatedAtIso,modelRunAt:null};
 saveFlightWeatherSnapshot(next);assert.deepEqual(loadFlightWeatherSnapshot(),next);
});
test('recalcul de lancement: métadonnées fiables conservées; réseau échoué conserve analyse',async t=>{
 env(t);const input=fixture();savePreparationDraft(input.preparation);saveTrajectoryAnalysisRequest(input.request);saveWeatherAnalysis(input.analysis);
 const fetchedAt='2026-09-18T05:00:05Z';
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:true,layerProjections:input.analysis.traces,windProfile:input.snapshot.windProfile,terrainAltitudeAmslM:20,weatherFetchedAt:fetchedAt,failures:[]})));
 assert.equal(await refreshCurrentWeatherAnalysis(),true);const analysis=loadWeatherAnalysis();assert.equal(analysis.traces[0].weatherFetchedAt,fetchedAt);assert.equal(analysis.traces[0].modelRunAt,null);
 assert.notEqual(analysis.traces[0].calculatedAtIso,fetchedAt);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('network');});assert.equal(await refreshCurrentWeatherAnalysis(),false);assert.deepEqual(loadWeatherAnalysis(),analysis);
});
test('recalcul: A→B pendant fetch refuse toute nouvelle persistance',async t=>{
 const {values}=env(t);const input=fixture();savePreparationDraft(input.preparation);saveTrajectoryAnalysisRequest(input.request);saveWeatherAnalysis(input.analysis);
 const before=[...values.entries()];
 let resolve;t.mock.method(globalThis,'fetch',()=>new Promise(yes=>resolve=yes));const pending=refreshCurrentWeatherAnalysis();
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'other-account',email:'other@example.com'}});
 resolve(new Response(JSON.stringify({ok:true,layerProjections:input.analysis.traces,windProfile:input.snapshot.windProfile,terrainAltitudeAmslM:20,weatherFetchedAt:'2026-09-18T05:00:05Z',failures:[]})));
 assert.equal(await pending,false);assert.equal(loadWeatherAnalysis(),null);assert.deepEqual([...values.entries()],before);
});
