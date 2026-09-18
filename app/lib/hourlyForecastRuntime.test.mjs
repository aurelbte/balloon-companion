import test from 'node:test';
import assert from 'node:assert/strict';
import { startHourlyForecastRuntime } from './weather/hourlyForecastRuntime.ts';
import { classifyWeatherFreshness, HOURLY_POLICY } from './weather/weatherFreshness.ts';
const now=Date.parse('2026-09-18T08:00Z');
const query={latitude:50,longitude:3,weatherModel:'arome_seamless'};
const data=(time=now)=>({model:query.weatherModel,latitude:50,longitude:3,timezone:'UTC',sourceUpdatedAt:new Date(time).toISOString(),points:[{timestamp:'2026-09-18T09:00',sourceUpdatedAt:new Date(time).toISOString(),model:query.weatherModel,weatherCode:'CLEAR'}]});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function env(t){
 const win=new EventTarget(),doc=new EventTarget(),network={onLine:true};doc.visibilityState='visible';
 for(const[key,value]of[['window',win],['document',doc],['navigator',network]]){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
 }
 t.mock.timers.enable({apis:['Date','setTimeout'],now});
 return {win,doc,network};
}
test('refresh nouveau dataset et échec: données conservées pendant transfert et après échec',async t=>{
 env(t);let state,calls=0,resolve,reject;
 const load=()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});};
 const runtime=startHourlyForecastRuntime(query,value=>state=value,()=>true,load);t.after(runtime.stop);
 assert.equal(calls,1);resolve(data());await flush();const first=state.data;
 runtime.retry();assert.equal(state.data,first);assert.equal(state.loading,true);assert.equal(calls,2);
 reject(Error('network'));await flush();assert.equal(state.data,first);assert.equal(state.error,true);assert.equal(state.loading,false);
 runtime.retry();resolve(data(now+1000));await flush();assert.notEqual(state.data,first);assert.equal(state.data.sourceUpdatedAt,new Date(now+1000).toISOString());
});
test('timer transition fraîcheur; cache inchangé; événements rapprochés sans boucle',async t=>{
 const e=env(t);let state,calls=0,resolve;
 const runtime=startHourlyForecastRuntime(query,value=>state=value,()=>true,()=>{calls++;return new Promise(yes=>resolve=yes);});t.after(runtime.stop);
 resolve(data());await flush();t.mock.timers.tick(30*60_000+1);assert.equal(calls,2);
 for(let i=0;i<3;i++){e.win.dispatchEvent(new Event('focus'));e.win.dispatchEvent(new Event('pageshow'));e.win.dispatchEvent(new Event('online'));e.doc.dispatchEvent(new Event('visibilitychange'));}
 assert.equal(calls,2);resolve(data());await flush();assert.equal(state.data.sourceUpdatedAt,new Date(now).toISOString());
 assert.equal(classifyWeatherFreshness(Date.now(),state.data.sourceUpdatedAt,HOURLY_POLICY),'STALE');
 t.mock.timers.tick(1000);await flush();assert.equal(calls,2);
 runtime.stop();t.mock.timers.tick(24*3_600_000);e.win.dispatchEvent(new Event('focus'));assert.equal(calls,2);
});
test('offline conserve les données jusqu’à EXPIRED; reprise et retour online actualisent',async t=>{
 const e=env(t);let state,calls=0;
 const runtime=startHourlyForecastRuntime(query,value=>state=value,()=>true,async()=>{calls++;return data(Date.now());});t.after(runtime.stop);
 await flush();const original=state.data;e.network.onLine=false;t.mock.timers.tick(3*3_600_000);
 e.win.dispatchEvent(new Event('pageshow'));e.doc.dispatchEvent(new Event('visibilitychange'));await flush();
 assert.equal(calls,1);assert.equal(state.data,original);assert.equal(state.error,true);assert.equal(classifyWeatherFreshness(Date.now(),state.data.sourceUpdatedAt,HOURLY_POLICY),'EXPIRED');
 e.network.onLine=true;e.win.dispatchEvent(new Event('online'));await flush();assert.equal(calls,2);assert.equal(classifyWeatherFreshness(Date.now(),state.data.sourceUpdatedAt,HOURLY_POLICY),'FRESH');
});
test('nouveau lieu/modèle: runtime vide; réponse de l’ancien runtime ignorée après cleanup',async t=>{
 env(t);let oldState,newState,resolve;
 const old=startHourlyForecastRuntime(query,value=>oldState=value,()=>true,()=>new Promise(yes=>resolve=yes));
 old.stop();const current=startHourlyForecastRuntime({...query,longitude:4,weatherModel:'gfs_seamless'},value=>newState=value,()=>true,async()=>({...data(),longitude:4,model:'gfs_seamless'}));t.after(current.stop);
 assert.equal(newState.data,null);await flush();resolve(data());await flush();assert.equal(oldState.data,null);assert.equal(newState.data.longitude,4);assert.equal(newState.data.model,'gfs_seamless');
});
test('changement de scope/génération pendant await: réponse abandonnée sans publication',async t=>{
 const e=env(t);let current=true,state,resolve,count=0;
 const runtime=startHourlyForecastRuntime(query,value=>{state=value;count++;},()=>current,()=>new Promise(yes=>resolve=yes));t.after(runtime.stop);
 const before=count;current=false;resolve(data());await flush();assert.equal(count,before);assert.equal(state.data,null);
 e.win.dispatchEvent(new Event('online'));t.mock.timers.tick(3_600_000);assert.equal(count,before);
});
test('échec initial/offline sans données: indisponible; événements ne contournent pas backoff',async t=>{
 const e=env(t);let state,calls=0;
 const runtime=startHourlyForecastRuntime(query,value=>state=value,()=>true,async()=>{calls++;throw Error('quota? network');});t.after(runtime.stop);
 await flush();assert.equal(state.data,null);assert.equal(state.error,true);
 for(let i=0;i<5;i++)e.win.dispatchEvent(new Event('online'));await flush();assert.equal(calls,1);
 t.mock.timers.tick(60_000);await flush();assert.equal(calls,2);
 for(let i=0;i<5;i++)e.win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,2);
});

test('requête bloquée: passage STALE→EXPIRED continue sans seconde requête',async t=>{
 env(t);let state,calls=0,resolve;
 const runtime=startHourlyForecastRuntime(query,value=>state=value,()=>true,()=>{calls++;return new Promise(yes=>resolve=yes);});t.after(runtime.stop);
 resolve(data());await flush();const original=state.data;t.mock.timers.tick(30*60_000+1);assert.equal(calls,2);
 t.mock.timers.tick(90*60_000);await flush();
 assert.equal(calls,2);assert.equal(state.data,original);assert.equal(state.loading,true);
 assert.equal(classifyWeatherFreshness(state.now,state.data.sourceUpdatedAt,HOURLY_POLICY),'EXPIRED');
 resolve(data(Date.now()));await flush();
});
