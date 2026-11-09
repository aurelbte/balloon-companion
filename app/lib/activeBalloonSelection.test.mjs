import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDefaultBalloonRegistry, loadBalloonRegistry, saveBalloonRegistry, setActiveBalloon, getActiveBalloon, BALLOON_REGISTRY_EVENT } from './balloonStorage.ts';
import { savePreparationDraft, loadPreparationDraft } from './preparationDraftStorage.ts';
import { PREPARATION_STORAGE_VERSION } from './flightStorage.ts';
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from './auth/dataScopeRuntime.ts';
import { resolvePreparationBalloon, withPreparationBalloonChoice } from './preparationBalloonSelection.ts';

function setup(t, guest=false){
  const values=new Map(), target=new EventTarget();
  const storage={ fail:false, get length(){return values.size;}, key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key),setItem(key,value){if(this.fail)throw Error('quota');values.set(key,value);}};
  const old=Object.fromEntries(['window','localStorage','indexedDB','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries({window:{localStorage:storage,sessionStorage:storage,dispatchEvent:event=>target.dispatchEvent(event)},localStorage:storage,indexedDB:undefined,navigator:{onLine:false}})) Object.defineProperty(globalThis,key,{configurable:true,value});
  setRuntimeAuthSnapshot(guest?{state:'SIGNED_OUT',user:null}:{state:'SIGNED_IN',user:{id:'active-balloon-test',email:'test@example.com',firstName:'',lastName:''}});
  setRuntimeGuestModeActive(guest);
  t.after(()=>{for(const [key,descriptor] of Object.entries(old)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}setRuntimeGuestModeActive(false);setRuntimeAuthSnapshot({state:'UNKNOWN',user:null});});
  return {storage,target};
}

for(const guest of [false,true])test(`active selection persists offline and broadcasts immediately (${guest?'guest':'account'})`,t=>{
  const {target}=setup(t,guest);
  saveBalloonRegistry(createDefaultBalloonRegistry());
  const before=loadBalloonRegistry(),second=before.balloons[1];
  let refreshed=null;
  target.addEventListener(BALLOON_REGISTRY_EVENT,()=>{refreshed=loadBalloonRegistry();});
  setActiveBalloon(second.id);
  assert.equal(refreshed.activeBalloonId,second.id);
  assert.equal(getActiveBalloon(refreshed).id,second.id); // Same selector as cockpit.
  assert.equal(loadBalloonRegistry().activeBalloonId,second.id); // Reopen/reload.
  assert.deepEqual(loadBalloonRegistry().balloons,before.balloons);
});

test('failed local persistence does not move badge or emit a false success',t=>{
  const {storage,target}=setup(t);
  saveBalloonRegistry(createDefaultBalloonRegistry());
  const before=loadBalloonRegistry(); let events=0;
  target.addEventListener(BALLOON_REGISTRY_EVENT,()=>events++);
  storage.fail=true;
  assert.throws(()=>setActiveBalloon(before.balloons[1].id),/quota/);
  assert.equal(loadBalloonRegistry().activeBalloonId,before.activeBalloonId);
  assert.equal(events,0);
});

test('active preference updates proposals only, preserving explicit selection, opt-out and unknown IDs',()=>{
  const {balloons}=createDefaultBalloonRegistry();
  const [a,b]=balloons;
  assert.equal(resolvePreparationBalloon(balloons,undefined,a.id).id,a.id);
  assert.equal(resolvePreparationBalloon(balloons,undefined,b.id).id,b.id);
  assert.equal(resolvePreparationBalloon(balloons,a.id,b.id).id,a.id);
  assert.equal(resolvePreparationBalloon(balloons,'',b.id),null);
  assert.equal(resolvePreparationBalloon(balloons,'missing',b.id),null);
  assert.equal(resolvePreparationBalloon(balloons,undefined,null),null);
});

test('autosaving never turns an active proposal into an explicit selection',()=>{
  const original={balloonName:'active-proposal',occupantsWeightKg:180};
  const implicit=withPreparationBalloonChoice(original,undefined);
  assert.equal('balloonName' in implicit,false);
  assert.equal(implicit.occupantsWeightKg,180);
  assert.equal(withPreparationBalloonChoice(original,'').balloonName,'');
  assert.equal(withPreparationBalloonChoice(original,'explicit').balloonName,'explicit');
  assert.equal(original.balloonName,'active-proposal');
});

test('activate button is outside the detail link; flight-record defaults retain recorded registration',()=>{
  const source=readFileSync(new URL('../more/profile/balloons/page.tsx',import.meta.url),'utf8');
  assert.ok(source.indexOf('</Link>\n      {registry.activeBalloonId !== balloon.id && <button')>0);
  assert.match(source,/setActiveBalloon\(id\)/);
  assert.match(source,/role=\{feedback.error \? "alert" : "status"\}/);
  const completion=readFileSync(new URL('../flight/complete/ascension/page.tsx',import.meta.url),'utf8');
  assert.match(completion,/flight\?\.balloonRegistration\s*\? registry.balloons.find/);
  assert.match(completion,/const value = existing \?\?/);
});


test('reloaded draft preserves explicit opt-out and keeps an automatic proposal responsive to active changes',t=>{
  setup(t);
  const {balloons}=createDefaultBalloonRegistry();
  const base={storageVersion:PREPARATION_STORAGE_VERSION,launchSite:{name:'TEST',latitude:50,longitude:3},departureTime:'2026-11-09T10:00:00Z',durationMinutes:60,weatherModel:'arome_seamless',targetAltitudeAmslM:null,occupantsWeightKg:180,createdAt:1,updatedAt:2};
  assert.equal(savePreparationDraft(withPreparationBalloonChoice(base,undefined)),true);
  let restored=loadPreparationDraft();
  assert.equal(restored.balloonName,undefined);
  assert.equal(restored.occupantsWeightKg,180);
  assert.equal(resolvePreparationBalloon(balloons,restored.balloonName,balloons[1].id).id,balloons[1].id);
  assert.equal(savePreparationDraft(withPreparationBalloonChoice(base,'')),true);
  restored=loadPreparationDraft();
  assert.equal(restored.balloonName,'');
  assert.equal(resolvePreparationBalloon(balloons,restored.balloonName,balloons[1].id),null);
});
