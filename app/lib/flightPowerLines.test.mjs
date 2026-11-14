import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightPowerLineRuntime } from './flightPowerLines.ts';
const paris={west:2.34,east:2.35,south:48.85,north:48.86},brussels={west:4.34,east:4.35,south:50.84,north:50.85};

test('flight lazy adapter coalesces module loading, handles chunk failures and never runs stale or unmounted updates',async()=>{
 let release,loads=0,constructed=0;const calls=[],states=[];
 class Reader {
  constructor(_publish,_store,_obstacles,_local,_be,_fr,options){constructed++;assert.equal(options.allowOverpassFallback,false);}
  async update(...args){calls.push(args);}
  stopLines(){} stop(){}
 }
 const gate=new Promise(resolve=>{release=resolve;});
 const runtime=new FlightPowerLineRuntime(s=>states.push(s),undefined,{load:async()=>{loads++;await gate;return {PreparationPowerLineRuntime:Reader};}});
 await runtime.update(paris,true,false,false);assert.equal(loads,0);assert.equal(states.length,0);
 const first=runtime.update(paris,true),second=runtime.update(brussels,true);
 assert.equal(loads,1);release();await Promise.all([first,second]);
 assert.equal(constructed,1);assert.equal(calls.length,1);assert.deepEqual(calls[0],[brussels,true,false,true]);
 runtime.stop();await runtime.update(paris,true);assert.equal(calls.length,1);
 let fail=true;const failures=[];
 const retry=new FlightPowerLineRuntime(s=>failures.push(s),undefined,{load:async()=>{if(fail)throw new Error('missing code chunk');return {PreparationPowerLineRuntime:Reader};}});
 await retry.update(paris,false);
 assert.equal(failures.at(-1).status,'UNAVAILABLE');assert.equal(failures.at(-1).covered,false);assert.equal(failures.at(-1).offline,true);
 assert.match(failures.at(-1).coverageLabel,/couverture non vérifiée/);
 fail=false;await retry.update(paris,true);assert.equal(calls.length,2);retry.stop();
 let finish;const unmountedStates=[];
 const unmounted=new FlightPowerLineRuntime(s=>unmountedStates.push(s),undefined,{load:()=>new Promise(resolve=>{finish=()=>resolve({PreparationPowerLineRuntime:Reader});})});
 const pending=unmounted.update(paris,true);const previous=constructed,count=unmountedStates.length;
 unmounted.stop();finish();await pending;assert.equal(constructed,previous);assert.equal(unmountedStates.length,count);
});
