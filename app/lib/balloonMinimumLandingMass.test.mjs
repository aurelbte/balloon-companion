import test from 'node:test';
import assert from 'node:assert/strict';
import { createBalloon, updateBalloon } from './balloons.ts';
import { balloonMinimumLandingMass, balloonMlmProposal, balloonMlmModelKey, balloonMlmRuleKey, balloonMlmConfirmationKey } from './balloonMinimumLandingMass.ts';
import { migrateBalloonRegistry, applyBalloonFromCloudWithoutEnqueue, BALLOON_REGISTRY_STORAGE_KEY, editBalloon, loadBalloonRegistry } from './balloonStorage.ts';
import { BrowserCloudSyncPayloadProvider } from './cloudSyncBrowser.ts';
import { parseBalloonCloudRow } from './cloudPullBrowser.ts';
import { setRuntimeAuthSnapshot, scopedBusinessStorageKey } from './auth/dataScopeRuntime.ts';
import { MemorySyncOutboxStorage } from './syncOutbox.ts';
import { mlmBalloon, withConfirmedMlm } from './balloonMinimumLandingMass.fixtures.mjs';
test('Cameron/Ultramagic documented proposals never become implicitly confirmed, nor derive from MTOM',()=>{
  const b=mlmBalloon();assert.equal(balloonMinimumLandingMass(b).valueKg,1247);assert.equal(balloonMinimumLandingMass(b).confirmed,false);
  assert.equal(balloonMinimumLandingMass({...b,applicableMtowKg:100}).valueKg,1247);
  assert.equal(balloonMinimumLandingMass({...b,model:'Z275LW'}).valueKg,null);
  assert.equal(balloonMinimumLandingMass({...b,manufacturer:'Ultramagic',model:'T150',volumeM3:4248}).valueKg,679);
  assert.equal(balloonMinimumLandingMass({...b,model:'UNKNOWN'}).valueKg,null);
});
test('confirmation survives creation, editing unrelated fields and offline reload; all configuration/reference/value changes revoke it',()=>{
  const b=withConfirmedMlm(mlmBalloon());
  assert.equal(balloonMinimumLandingMass(createBalloon(b,b.id)).confirmed,true);
  assert.equal(balloonMinimumLandingMass(updateBalloon(b,{...b,color:'Rouge'})).confirmed,true);
  const registry=migrateBalloonRegistry(JSON.parse(JSON.stringify({version:5,balloons:[b],activeBalloonId:b.id})));
  assert.equal(balloonMinimumLandingMass(registry.balloons[0]).confirmed,true);
  for(const patch of [{model:'Z275LW'},{volumeM3:7787},{registration:'CN-OTHER'},{applicableMtowKg:1999},{category:'Libre à gaz'},
    {weights:{...b.weights,basketKg:301}}, {weights:{...b.weights,fullCylinders:[{id:'different',fullWeightKg:150}]}},
    ...[{reference:'changed edition'},{valueKg:1248},{ruleKey:'stale registry'}].map(p=>({minimumLandingMass:{...b.minimumLandingMass,...p}}))]) {
    const changed=updateBalloon(b,{...b,...patch});assert.equal(balloonMinimumLandingMass(changed).confirmed,false,JSON.stringify(patch));assert.equal(changed.minimumLandingMass.confirmed,false);
  }
  const changed=updateBalloon(b,{...b,weights:{...b.weights,basketKg:301}});
  assert.equal(balloonMinimumLandingMass(updateBalloon(changed,{...changed,weights:b.weights})).confirmed,false);
  const legacy=migrateBalloonRegistry({version:5,balloons:[mlmBalloon()]});assert.equal(legacy.balloons[0].minimumLandingMass,undefined);
});
test('cloud JSONB round-trip and offline mutation preserve the reference, confirmation, equipment and outbox',async()=>{
  const scope='USER:mlm-test', values=new Map(), storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const previousWindow=globalThis.window;globalThis.window={localStorage:storage,dispatchEvent:()=>true};
  setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'mlm-test',email:'test@example.test',firstName:'',lastName:''}});
  try {
    const b=withConfirmedMlm(mlmBalloon()),key=scopedBusinessStorageKey(scope,BALLOON_REGISTRY_STORAGE_KEY);
    storage.setItem(key,JSON.stringify({version:5,balloons:[b],activeBalloonId:b.id}));
    const outbox=new MemorySyncOutboxStorage();
    await editBalloon(b.id,{...b,color:'Bleu'},(type,id,operation)=>outbox.enqueue({entityType:type,entityId:id,operation}));
    assert.equal(balloonMinimumLandingMass(loadBalloonRegistry().balloons[0]).confirmed,true);
    assert.equal((await outbox.list()).length,1);
    const built=await new BrowserCloudSyncPayloadProvider(storage,scope).build((await outbox.list())[0]);
    assert.deepEqual(built.payload.weights.minimumLandingMass,b.minimumLandingMass);
    const row=parseBalloonCloudRow({...built.payload,id:b.id,user_id:'mlm-test',revision:1,created_at:'2026-11-26T07:30:00Z',updated_at:'2026-11-26T07:30:00Z',deleted_at:null});
    storage.removeItem(key);assert.equal(applyBalloonFromCloudWithoutEnqueue(scope,row.value,storage),true);
    const restored=loadBalloonRegistry().balloons[0];assert.equal(balloonMinimumLandingMass(restored).confirmed,true);assert.deepEqual(restored.weights,b.weights);assert.equal((await outbox.list()).length,1);
    const stale=parseBalloonCloudRow({...built.payload,id:b.id,user_id:'mlm-test',model:'Z275LW',revision:2,created_at:'2026-11-26T07:30:00Z',updated_at:'2026-11-26T08:30:00Z',deleted_at:null});
    applyBalloonFromCloudWithoutEnqueue(scope,stale.value,storage);assert.equal(balloonMinimumLandingMass(loadBalloonRegistry().balloons[0]).confirmed,false);
  } finally {globalThis.window=previousWindow;setRuntimeAuthSnapshot({state:'SIGNED_OUT'});}
});
