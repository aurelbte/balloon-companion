import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from './auth/dataScopeRuntime.ts';
import { moroccoPreparationIntentKey, readMoroccoPreparationIntent, saveMoroccoPreparationIntent, moroccoCalculationAcquisitionOptions } from './moroccoPreparationIntent.ts';

const request={version:2,launchSite:{name:'Terrain',latitude:31.5,longitude:-8},launchDateTimeIso:'2026-11-23T07:00:00Z',durationSeconds:3600,weatherModel:'ecmwf_ifs025',altitudesAmslM:[1000]};
test('explicit Morocco destination persists across map reopening, isolates accounts/preparations and defaults to no extra arrival',()=>{
  const rows=new Map(),storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
  setRuntimeAuthSnapshot({state:'SIGNED_OUT',user:null});setRuntimeGuestModeActive(true);
  assert.equal(readMoroccoPreparationIntent(request,storage),false);
  assert.deepEqual(moroccoCalculationAcquisitionOptions(false),{archiveMoroccoWeather:true,acquireMoroccoArrivalWeather:false});
  assert.equal(saveMoroccoPreparationIntent(request,true,storage),true);
  assert.equal(readMoroccoPreparationIntent(structuredClone(request),storage),true);
  assert.equal(moroccoCalculationAcquisitionOptions(readMoroccoPreparationIntent(request,storage)).acquireMoroccoArrivalWeather,true);
  for(const r of [{...request,durationSeconds:7200},{...request,launchDateTimeIso:'2026-11-24T07:00:00Z'},{...request,launchSite:{...request.launchSite,latitude:32}}]) {
    assert.notEqual(moroccoPreparationIntentKey(r),moroccoPreparationIntentKey(request));assert.equal(readMoroccoPreparationIntent(r,storage),false);
  }
  setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'another-user'}});
  assert.equal(readMoroccoPreparationIntent(request,storage),false);
  setRuntimeAuthSnapshot({state:'SIGNED_OUT',user:null});
  assert.equal(saveMoroccoPreparationIntent(request,false,storage),true);assert.equal(readMoroccoPreparationIntent(request,storage),false);
  assert.equal(saveMoroccoPreparationIntent(request,true,{getItem(){return null;},setItem(){throw Error('quota');}}),false);
});

test('/map uses persisted explicit intent at calculation time; export never initiates a current-weather catch-up',()=>{
  const map=readFileSync(new URL('../map/page.tsx',import.meta.url),'utf8');
  const action=readFileSync(new URL('../components/FlightDossierAction.tsx',import.meta.url),'utf8');
  assert.match(map,/moroccoCalculationAcquisitionOptions\(readMoroccoPreparationIntent\(config.request\)\)/);
  assert.match(map,/JSON.stringify\(\{ \.\.\.request, \.\.\.acquisitionOptions \}\)/);
  assert.match(map,/saveMoroccoPreparationIntent\(config.request, enabled\)/);
  assert.match(action,/Préparation Maroc avec vent d’arrivée/);
  assert.match(action,/onMoroccoDestinationChange\?\.\(true\)/);
  const exportBody=action.slice(action.indexOf('const requestDossier'),action.indexOf('const openPassengerListing'));
  assert.doesNotMatch(exportBody,/onCalculateMorocco|trajectory\/project|acquireMoroccoArrivalWeather/);
  assert.match(exportBody,/minimumLandingMassApplicability/);
  assert.match(exportBody,/plannedMaximumAltitudeMslM: validatedAltitudeAmslM/);
});
