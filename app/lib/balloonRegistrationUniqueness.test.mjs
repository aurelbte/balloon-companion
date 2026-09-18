import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { balloonRegistrationKey, duplicateBalloonRegistrationKeys } from './balloons.ts';
import { addBalloonToRegistry, updateBalloonInRegistry, removeBalloonFromRegistry, migrateBalloonRegistry, addBalloon, editBalloon, loadBalloonRegistry, saveBalloonRegistry } from './balloonStorage.ts';
import { setRuntimeAuthSnapshot } from './auth/dataScopeRuntime.ts';
const input = registration => ({ registration, manufacturer:'Cameron', model:'Z105', category:'Libre à air chaud', volumeM3:2973, weights:{fullCylinders:[]} });
const empty = () => ({version:5, balloons:[], activeBalloonId:null});
const first = () => addBalloonToRegistry(empty(),input('F-ABCD'));
for (const registration of ['F-ABCD','f-abcd',' F-ABCD ','F ABCD']) test(`CREATE refuses saved duplicate ${registration}`,()=>{
 const a=first(), before=structuredClone(a.registry);
 assert.throws(()=>addBalloonToRegistry(a.registry,input(registration)),{code:'DUPLICATE_REGISTRATION'});
 assert.deepEqual(a.registry,before);
});
test('comparison preserves historical separators',()=>{
 const keys=['F ABCD','F-ABCD','F–ABCD','F—ABCD'].map(balloonRegistrationKey);
 assert.equal(new Set(keys).size,4);
 const a=first(); for (const reg of ['F–ABCD','F—ABCD']) assert.equal(addBalloonToRegistry(a.registry,input(reg)).registry.balloons.length,2);
 const historical={...a.registry,balloons:[{...a.balloon,registration:'F ABCD'}]};
 assert.equal(addBalloonToRegistry(historical,input('F-ABCD')).registry.balloons.length,2);
});
test('UPDATE refuses collision, leaves old object, permits same ID and correction',()=>{
 const a=first(), b=addBalloonToRegistry(a.registry,input('F-EFGH')), before=structuredClone(b.registry);
 assert.throws(()=>updateBalloonInRegistry(b.registry,b.balloon.id,input(' f-abcd ')),{code:'DUPLICATE_REGISTRATION'});
 assert.deepEqual(b.registry,before);
 assert.equal(updateBalloonInRegistry(b.registry,a.balloon.id,input(' f-abcd ')).balloons.length,2);
 assert.equal(updateBalloonInRegistry(b.registry,b.balloon.id,input('F-IJKL')).balloons[1].registration,'F-IJKL');
});
test('preexisting duplicates retain IDs and documents; correction possible',()=>{
 const a=first(), b={...a.balloon,id:'old-other',registration:' f-abcd ',documents:[{id:'doc'}]};
 const registry=migrateBalloonRegistry({...a.registry,balloons:[a.balloon,b]});
 assert.equal(registry.balloons.length,2); assert.equal(registry.balloons[1].documents[0].id,'doc');
 assert.deepEqual(duplicateBalloonRegistrationKeys(registry.balloons),['F-ABCD']);
 assert.throws(()=>addBalloonToRegistry(registry,input('F-ABCD')),{code:'DUPLICATE_REGISTRATION'});
 assert.deepEqual(duplicateBalloonRegistrationKeys(updateBalloonInRegistry(registry,b.id,input('F-EFGH')).balloons),[]);
});
test('delete frees local registration without replacing historical ID',()=>{
 const a=first(), b=addBalloonToRegistry(removeBalloonFromRegistry(a.registry,a.balloon.id),input('F-ABCD'));
 assert.notEqual(b.balloon.id,a.balloon.id); assert.equal(a.balloon.registration,'F-ABCD');
});
test('rejected operations write no business value, intent or outbox; accounts isolated',async()=>{
 const previous=globalThis.window; const values=new Map(); let writes=0, enqueues=0;
 globalThis.window={localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{writes++;values.set(k,v);},removeItem:k=>values.delete(k)},dispatchEvent:()=>true};
 try {
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'c11-A'}});const a=first(), b=addBalloonToRegistry(a.registry,input('F-EFGH'));saveBalloonRegistry(b.registry);
 const before=[...values], count=writes;const enqueue=async()=>{enqueues++;return {};};
 await assert.rejects(addBalloon(input('F-ABCD'),enqueue),{code:'DUPLICATE_REGISTRATION'});
 await assert.rejects(editBalloon(b.balloon.id,input('F-ABCD'),enqueue),{code:'DUPLICATE_REGISTRATION'});
 assert.equal(writes,count);assert.equal(enqueues,0);assert.deepEqual([...values],before);
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'c11-B'}});
 assert.equal(loadBalloonRegistry().balloons.length,0);assert.ok(await addBalloon(input('F-ABCD'),enqueue));
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'c11-A'}});assert.deepEqual(loadBalloonRegistry().balloons,b.registry.balloons);
 } finally {globalThis.window=previous;setRuntimeAuthSnapshot({state:'SIGNED_OUT',user:null});}
});
test('two independent concurrent snapshots are not falsely protected by local validation',()=>{
 assert.equal(addBalloonToRegistry(empty(),input('F-ABCD')).registry.balloons.length,1);
 assert.equal(addBalloonToRegistry(empty(),input('F-ABCD')).registry.balloons.length,1);
});
test('UI exposes inline error and retains forms on duplicate',async()=>{
 for(const file of ['app/more/profile/balloons/new/page.tsx','app/more/profile/balloons/[id]/edit/page.tsx']) {
 const source=await readFile(file,'utf8');assert.match(source,/instanceof DuplicateBalloonRegistrationError\) setSubmissionError\(error.message\)/);assert.match(source,/submissionError=\{submissionError\}/);
 }
 assert.match(await readFile('app/components/balloons/BalloonForm.tsx','utf8'),/submissionError && <p role="alert">/);
});

test('DELETE pending and reuse retain distinct outbox identities',async()=>{
 const {MemorySyncOutboxStorage}=await import('./syncOutbox.ts');const {deleteBalloon}=await import('./balloonStorage.ts');
 const previous=globalThis.window,values=new Map();let serial=0;
 globalThis.window={localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},dispatchEvent:()=>true};
 try {
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'c11-delete'}});
 const queue=new MemorySyncOutboxStorage({dependencies:{createId:()=>`m-${++serial}`,now:()=> '2026-09-18T10:00:00.000Z'}});
 const enqueue=async(entityType,entityId,operation)=>{await queue.enqueue({entityType,entityId,operation});return true;};
 const a=await addBalloon(input('F-ABCD'),enqueue);assert.equal(await deleteBalloon(a.id,enqueue),true);
 const b=await addBalloon(input('F-ABCD'),enqueue);assert.notEqual(a.id,b.id);
 const pending=await queue.list();assert.ok(pending.some(x=>x.entityId===a.id&&x.operation==='DELETE'));assert.ok(pending.some(x=>x.entityId===b.id&&x.operation==='UPSERT'));
 assert.deepEqual(loadBalloonRegistry().balloons.map(x=>x.id),[b.id]);
 } finally {globalThis.window=previous;setRuntimeAuthSnapshot({state:'SIGNED_OUT',user:null});}
});
