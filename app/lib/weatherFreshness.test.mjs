import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWeatherFreshness, HOURLY_POLICY, ANALYSIS_POLICY, oldestWeatherRetrieval, retrievalLabel } from './weather/weatherFreshness.ts';
import { authorizeWeatherLaunch } from './weather/weatherLaunch.ts';
import { OpenMeteoHourlyForecastProvider, clearHourlyForecastCacheForTests } from './weather/openMeteo/hourlyForecast.ts';
import { readFileSync } from 'node:fs';
const now = Date.parse('2026-09-18T12:00:00Z');
const ago = minutes => new Date(now - minutes * 60_000).toISOString();
for (const [policy, limit] of [[HOURLY_POLICY,120],[ANALYSIS_POLICY,60]]) {
  for (const [minutes,status] of [[0,'FRESH'],[30,'FRESH'],[30.01,'STALE'],[limit,'STALE'],[limit+.01,'EXPIRED']]) test(`seuil ${limit}min, âge ${minutes}: ${status}`,()=>assert.equal(classifyWeatherFreshness(now,ago(minutes),policy),status));
  for (const value of [undefined,null,'','invalid','2026-09-18T11:00',new Date(now+1).toISOString()]) test(`seuil ${limit}min, timestamp ${value}: UNKNOWN`,()=>assert.equal(classifyWeatherFreshness(now,value,policy),'UNKNOWN'));
}
test('multi-modèles: source la plus ancienne; une source inconnue/future invalide le verdict',()=>{
 assert.equal(oldestWeatherRetrieval([{weatherFetchedAt:ago(10)},{weatherFetchedAt:ago(40)}],now),ago(40));
 assert.equal(oldestWeatherRetrieval([{weatherFetchedAt:ago(10)},{}],now),undefined);
 assert.equal(oldestWeatherRetrieval([{weatherFetchedAt:ago(10)},{weatherFetchedAt:new Date(now+1).toISOString()}],now),undefined);
});
test('ancienneté reste explicite après plusieurs jours, timestamp invalide non inventé',()=>{
 assert.match(retrievalLabel(ago(3*24*60),now),/4320 min/); assert.match(retrievalLabel('invalid',now),/inconnue/);
});
test('hourly: capture après réception; cache ne rajeunit pas sa récupération',async()=>{
 clearHourlyForecastCacheForTests();let clock=now,calls=0;
 const payload={latitude:50,longitude:3,timezone:'UTC',hourly:{time:['2026-09-18T12:00']}};
 const provider=new OpenMeteoHourlyForecastProvider({fetchHourlyForecast:async()=>{calls++;clock+=5000;return payload;}},()=>clock);
 const query={latitude:50,longitude:3,weatherModel:'arome_seamless'};
 const first=await provider.getForecast(query);assert.equal(first.sourceUpdatedAt,new Date(now+5000).toISOString());
 clock+=60_000;const cached=await provider.getForecast(query);assert.equal(cached.sourceUpdatedAt,first.sourceUpdatedAt);assert.equal(calls,1);
 clock+=16*60_000;const second=await provider.getForecast(query);assert.notEqual(second.sourceUpdatedAt,first.sourceUpdatedAt);assert.equal(calls,2);
});
for(const [age,status,confirmations] of [[5,'FRESH',0],[40,'STALE',0],[70,'EXPIRED',1],[null,'UNKNOWN',1]]) test(`lancement ${status}: confirmation ${confirmations}`,async()=>{
 const snapshot=age===null?{sourceUpdatedAt:ago(5)}:{weatherFetchedAt:ago(age)}; const before=JSON.stringify(snapshot);let count=0;
 const result=await authorizeWeatherLaunch({read:()=>snapshot,refresh:async()=>false,online:()=>false,current:()=>true,clock:()=>now,confirm:async(_,actual)=>{count++;assert.equal(actual,status);return true;}});
 assert.equal(result.allowed,true);assert.equal(count,confirmations);assert.equal(JSON.stringify(snapshot),before);
});
test('annulation: pas de lancement; autorisation non persistée',async()=>{
 let count=0;const snapshot={weatherFetchedAt:ago(70)};
 const options={read:()=>snapshot,refresh:async()=>false,online:()=>false,current:()=>true,clock:()=>now,confirm:async()=>{count++;return false;}};
 assert.equal((await authorizeWeatherLaunch(options)).allowed,false); assert.equal((await authorizeWeatherLaunch(options)).allowed,false);assert.equal(count,2);
});
test('refresh avant décision; échec conserve et qualifie; changement identité/analyse refuse',async()=>{
 let snapshot={weatherFetchedAt:ago(70)}, confirmations=0;
 const options={read:()=>snapshot,refresh:async()=>{snapshot={weatherFetchedAt:ago(1)};return true;},online:()=>true,current:()=>true,clock:()=>now,confirm:async()=>{confirmations++;return true;}};
 assert.equal((await authorizeWeatherLaunch(options)).allowed,true);assert.equal(confirmations,0);
 snapshot={weatherFetchedAt:ago(70)};options.refresh=async()=>{throw Error('network');};
 assert.equal((await authorizeWeatherLaunch(options)).allowed,true);assert.equal(confirmations,1);assert.equal(snapshot.weatherFetchedAt,ago(70));
 options.confirm=async()=>{snapshot={weatherFetchedAt:ago(80)};return true;};assert.equal((await authorizeWeatherLaunch(options)).allowed,false);
 options.current=()=>false;assert.equal((await authorizeWeatherLaunch(options)).allowed,false);
});
test('contrat: récupération projection après parsing, confirmation locale, snapshot actif historique',()=>{
 const adapter=readFileSync(new URL('./weather/openMeteo/adapter.ts',import.meta.url),'utf8');
 assert.ok(adapter.indexOf('this.onRetrieved?.')>adapter.indexOf('parseOpenMeteoWindColumn('));
 const route=readFileSync(new URL('../api/trajectory/project/route.ts',import.meta.url),'utf8');assert.match(route,/weatherFetchedAt = retrievals.sort/);
 const flight=readFileSync(new URL('../flight/page.tsx',import.meta.url),'utf8');
 assert.match(flight,/activeFlight \? activeFlight.weatherSnapshot \?\? null : flightWeatherSnapshot/);
 assert.match(flight,/!storageReady \|\| isTracking \|\| activeFlight/);assert.match(flight,/Continuer avec ces données/);
 assert.match(flight,/weatherLaunchConfirmation.resolve\(false\)/);assert.match(flight,/weatherLaunchConfirmation.resolve\(true\)/);
 const types=readFileSync(new URL('./trajectory/weatherAnalysisStorage.ts',import.meta.url),'utf8');assert.match(types,/weatherFetchedAt\?: string/);assert.match(types,/value.version === 1/);
});

test('passage à EXPIRED pendant décision: confirmation requise avant autorisation',async()=>{
 let clock=now;const snapshot={weatherFetchedAt:ago(59)};let count=0;
 const result=await authorizeWeatherLaunch({read:()=>snapshot,refresh:async()=>false,online:()=>false,current:()=>true,clock:()=>{const value=clock;clock+=2*60_000;return value;},confirm:async()=>{count++;return false;}});
 assert.equal(result.allowed,false);assert.equal(count,1);
});
