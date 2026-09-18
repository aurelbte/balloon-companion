import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { authorizeWeatherLaunch, launchNeedsWeatherConfirmation } from './weather/weatherLaunch.ts';
import { ANALYSIS_POLICY, classifyWeatherFreshness, freshnessLabel, retrievalLabel } from './weather/weatherFreshness.ts';
const now=Date.parse('2026-09-18T12:00Z');
function handler(t,age,{active=false}={}){
 t.mock.method(Date,'now',()=>now);
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});t.after(()=>old?Object.defineProperty(globalThis,'navigator',old):delete globalThis.navigator);
 const oldWindow=globalThis.window;globalThis.window={location:{search:''}};t.after(()=>globalThis.window=oldWindow);
 const snapshot={forecastAtIso:'2026-09-18T12:00Z',...(age===null?{}:{weatherFetchedAt:new Date(now-age*60_000).toISOString()}),windProfile:[],version:1};
 const original=JSON.stringify(snapshot),position={latitude:50,longitude:3,timestamp:now};
 let confirmation,notice,calls=0,captured;
 const busy={current:false},latest={current:{position,available:true}};
 const source=readFileSync(new URL('../flight/page.tsx',import.meta.url),'utf8');
 const raw=source.slice(source.indexOf('  const handleStartTracking ='),source.indexOf('  const handleDemoFlightEnd ='));
 const code=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const values={
  useCallback:callback=>callback,storageReady:true,isTracking:active,activeFlight:active?{weatherSnapshot:snapshot}:null,
  weatherLaunchBusyRef:busy,geoState:'active',isStale:false,currentPosition:position,
  shouldStartGpslessTargetedLiveFlight:()=>false,setTargetedLiveTestFlightActive:()=>{},loadPreparationDraft:()=>null,
  balloonRegistry:{balloons:[]},getRuntimeDataScope:()=> 'USER:A',getRuntimeDataScopeGeneration:()=>1,
  getTrajectoryAnalysisRequest:()=>null,weatherLaunchMountedRef:{current:true},
  setWeatherLaunchNotice:value=>notice=value,authorizeWeatherLaunch,launchNeedsWeatherConfirmation,
  loadValidatedFlightWeather:()=>({snapshot,trajectories:[]}),refreshCurrentWeatherAnalysis:async()=>false,
  weatherDecisionRef:{current:null},setWeatherLaunchConfirmation:value=>confirmation=value,
  setValidatedWeatherSnapshot:()=>{},setPlannedTrajectories:()=>{},classifyWeatherFreshness,ANALYSIS_POLICY,freshnessLabel,retrievalLabel,
  startTracking:async(p,context)=>{calls++;captured={p,context};},latestLaunchPositionRef:latest,
  markAcquiring:()=>{},requestPermission:()=>{},
 };
 const run=new Function(...Object.keys(values),code+';return handleStartTracking;')(...Object.values(values));
 return{run,busy,latest,snapshot,original,get confirmation(){return confirmation;},get notice(){return notice;},get calls(){return calls;},get captured(){return captured;}};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
for(const [age,status]of[[5,'FRESH'],[40,'STALE']])test(`handler réel ${status}: lancement normal et avertissement STALE`,async t=>{
 const h=handler(t,age);await h.run();assert.equal(h.calls,1);assert.equal(h.confirmation,undefined);assert.equal(h.busy.current,false);assert.equal(JSON.stringify(h.snapshot),h.original);
 if(status==='STALE')assert.match(h.notice,/anciennes/);else assert.equal(h.notice,null);
});
for(const [age,status]of[[70,'EXPIRED'],[null,'UNKNOWN']])for(const accepted of[false,true])test(`handler réel ${status}: ${accepted?'continuer':'annuler'}`,async t=>{
 const h=handler(t,age);const pending=h.run();await flush();assert.equal(h.calls,0);assert.equal(h.confirmation.status,status);assert.equal(h.busy.current,true);
 await h.run();assert.equal(h.calls,0);h.confirmation.resolve(accepted);await pending;assert.equal(h.calls,accepted?1:0);assert.equal(h.busy.current,false);assert.equal(JSON.stringify(h.snapshot),h.original);
 if(accepted)assert.equal(h.captured.context.weatherSnapshot,h.snapshot);
});
test('vol actif: aucune vérification, actualisation ou confirmation de lancement',async t=>{
 const h=handler(t,70,{active:true});await h.run();assert.equal(h.calls,0);assert.equal(h.confirmation,undefined);assert.equal(h.notice,undefined);
});
test('GPS perdu pendant confirmation: aucun lancement depuis le point capturé avant await',async t=>{
 const h=handler(t,70);const pending=h.run();await flush();h.latest.current={position:null,available:false};h.confirmation.resolve(true);await pending;
 assert.equal(h.calls,0);assert.match(h.notice,/GPS indisponible/);
});

test('vol devenu actif pendant confirmation: aucun second lancement',async t=>{
 const h=handler(t,70);const pending=h.run();await flush();h.latest.current.recording=true;h.confirmation.resolve(true);await pending;
 assert.equal(h.calls,0);assert.equal(h.busy.current,false);
});
