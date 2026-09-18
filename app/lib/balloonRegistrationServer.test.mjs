import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CloudSyncService,CloudSyncTransportError,MemoryCloudSyncIssueRepository,inspectAutomaticMutationEligibility,nextEligibleRetryAt} from './cloudSyncService.ts';
import {MemorySyncOutboxStorage} from './syncOutbox.ts';
import {mutationResult} from './cloudSyncBrowser.ts';
import {inspectCloudSyncVerdict} from './cloudSyncVerdict.ts';
import {resolveCrudConflictLocalWins,resolveCrudConflictServerWins} from './crudConflictResolution.ts';
const at='2026-09-18T12:00:00.000Z';
const duplicate={status:'BUSINESS_CONFLICT',businessCode:'DUPLICATE_REGISTRATION',entityId:'b',revision:null,serverUpdatedAt:null,deletedAt:null};
function context(actor='A',cloud=new Map()) {
 let serial=0,scope=`USER:${actor}`,registration='F-ABCD';const calls=[];
 const outbox=new MemorySyncOutboxStorage({dependencies:{createId:()=>`${actor}-${++serial}`,now:()=>at}}),issues=new MemoryCloudSyncIssueRepository();
 const deps={outbox,issues,getScope:()=>scope,getOnlineUserId:async()=>actor,now:()=>new Date(at),
 buildPayload:async mutation=>({serverEntityType:'balloon',serverEntityId:mutation.entityId,payload:{registration}}),
 applyMutation:async req=>{
 calls.push(structuredClone(req));const row=cloud.get(`${actor}:${req.entityId}`);
 if(req.operation==='DELETE'){
  if(!row)return {status:'NOT_FOUND',entityId:req.entityId,revision:null,serverUpdatedAt:null,deletedAt:null};
  row.deleted=true;row.revision++;return {status:'APPLIED',entityId:req.entityId,revision:row.revision,serverUpdatedAt:at,deletedAt:at};
 }
 const key=req.payload.registration.trim().toUpperCase();
 if([...cloud].some(([id,r])=>id.startsWith(`${actor}:`)&&id!==`${actor}:${req.entityId}`&&!r.deleted&&r.registration.trim().toUpperCase()===key))return {...duplicate,entityId:req.entityId};
 if(row&&row.revision!==req.baseRevision)return {status:'CONFLICT',entityId:req.entityId,revision:row.revision,serverUpdatedAt:at,deletedAt:null};
 const revision=row?row.revision+1:0;cloud.set(`${actor}:${req.entityId}`,{registration:req.payload.registration,revision,deleted:false});
 return {status:'APPLIED',entityId:req.entityId,revision,serverUpdatedAt:at,deletedAt:null};
 }};
 return {outbox,issues,cloud,calls,deps,service:new CloudSyncService(deps),registration:value=>registration=value,switchScope:value=>scope=value};
}
test('encoded C11 result is distinct from revision conflict; unknown status remains SERVER',()=>{
 assert.deepEqual(mutationResult([{status:'BUSINESS_CONFLICT:DUPLICATE_REGISTRATION',entity_id:'b'}]),duplicate);
 assert.equal(mutationResult([{status:'CONFLICT'}]).status,'CONFLICT');
 for(const status of ['23505','BUSINESS_CONFLICT:OTHER','BUSINESS_CONFLICT'])assert.throws(()=>mutationResult([{status}]),e=>e instanceof CloudSyncTransportError&&e.kind==='SERVER');
});
for(const operation of ['CREATE','UPDATE'])test(`second ${operation} remains durable and blocked without network retries`,async()=>{
 const c=context();c.cloud.set('A:a',{registration:'F-ABCD',revision:0,deleted:false});
 if(operation==='UPDATE'){c.cloud.set('A:b',{registration:'F-EFGH',revision:3,deleted:false});await c.outbox.setMetadata({entityType:'balloon',entityId:'b',revision:3,updatedAt:at});}
 const pending=await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT',mutationId:'durable-c2-intent'});
 const result=await c.service.syncPendingMutations();assert.equal(result.state,'PENDING');assert.equal(result.applied,0);assert.equal(result.conflicts,1);
 const [blocked]=await c.outbox.list();assert.equal(blocked.mutationId,pending.mutationId);assert.equal(blocked.lastErrorCode,'DUPLICATE_REGISTRATION');assert.equal(blocked.nextAttemptAt,undefined);
 assert.deepEqual(blocked.durableIntentIds,['durable-c2-intent']);assert.equal(blocked.payloadSnapshot.payload.registration,'F-ABCD');
 assert.equal(inspectAutomaticMutationEligibility(blocked).reason,'CONFLICT_BLOCKED');assert.equal(nextEligibleRetryAt([{...blocked,nextAttemptAt:'2099-01-01'}]),null);
 for(let i=0;i<3;i++)await c.service.syncPendingMutations();assert.equal(c.calls.length,1);
 const [issue]=await c.issues.list();assert.equal(issue.kind,'BUSINESS_CONFLICT');assert.equal(issue.businessCode,'DUPLICATE_REGISTRATION');
 const verdict=await inspectCloudSyncVerdict({getScope:()=> 'USER:A',getGeneration:()=>1,runtime:()=>({scope:'USER:A'}),online:()=>true,read:async()=>({mutations:await c.outbox.list(),issues:await c.issues.list(),intents:1,tracks:[],traceActive:false,traceDiscoveryComplete:true,coverageComplete:true,passGeneration:1})});assert.equal(verdict.state,'CONFLICT');
});
test('two offline devices of same account: first succeeds, second conflicts; different account allowed',async()=>{
 const cloud=new Map(),a=context('A',cloud),b=context('A',cloud),other=context('B',cloud);
 await a.outbox.enqueue({entityType:'balloon',entityId:'one',operation:'UPSERT'});await b.outbox.enqueue({entityType:'balloon',entityId:'two',operation:'UPSERT'});
 assert.equal((await a.service.syncPendingMutations()).applied,1);assert.equal((await b.service.syncPendingMutations()).conflicts,1);
 assert.equal([...cloud].filter(([id,r])=>id.startsWith('A:')&&!r.deleted).length,1);
 await other.outbox.enqueue({entityType:'balloon',entityId:'one',operation:'UPSERT'});assert.equal((await other.service.syncPendingMutations()).applied,1);
});
test('explicit retry after resolving owner uses same mutationId/snapshot and receipts C2 only on success',async()=>{
 const c=context();c.cloud.set('A:a',{registration:'F-ABCD',revision:0,deleted:false});
 await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT',mutationId:'intent-b'});await c.service.syncPendingMutations();
 c.registration('F-CHANGED');c.cloud.get('A:a').deleted=true;
 const result=await c.service.retryDuplicateRegistration('b');assert.equal(result.applied,1);assert.equal(result.state,'COMPLETED');
 assert.equal(c.calls[0].mutationId,c.calls[1].mutationId);assert.deepEqual(c.calls[0].payload,c.calls[1].payload);
 assert.deepEqual((await c.outbox.getMetadata('balloon','b')).acknowledgedLocalIntentIds,['intent-b']);assert.equal((await c.outbox.list()).length,0);assert.equal((await c.issues.list()).length,0);
});
test('business conflict cannot enter either revision resolution action',async()=>{
 const c=context();c.cloud.set('A:a',{registration:'F-ABCD',revision:0,deleted:false});await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT'});await c.service.syncPendingMutations();
 for(const resolve of [resolveCrudConflictLocalWins,resolveCrudConflictServerWins])await assert.rejects(resolve('balloon','b',{...c.deps,readCloud:()=>assert.fail('must not rebase business conflict')}),{code:'CONFLICT_NOT_FOUND'});
 assert.equal((await c.outbox.list()).length,1);
});
test('B5: newer edit during duplicate response survives exact retry/ack of older snapshot',async()=>{
 const c=context();const apply=c.deps.applyMutation;c.deps.applyMutation=async request=>{await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT',mutationId:'intent-newer'});return {...duplicate,entityId:request.entityId};};
 await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT',mutationId:'intent-old'});await c.service.syncPendingMutations();assert.equal((await c.outbox.list()).length,2);
 c.deps.applyMutation=apply;await c.service.retryDuplicateRegistration('b');const remaining=await c.outbox.list();assert.equal(remaining.length,1);assert.deepEqual(remaining[0].durableIntentIds,['intent-newer']);
});
test('DELETE/reuse is ordered even when CREATE listed first; tombstone remains',async()=>{
 const c=context();c.cloud.set('A:a',{registration:'F-ABCD',revision:0,deleted:false});await c.outbox.setMetadata({entityType:'balloon',entityId:'a',revision:0,updatedAt:at});
 await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT'});await c.outbox.enqueue({entityType:'balloon',entityId:'a',operation:'DELETE'});
 const result=await c.service.syncPendingMutations();assert.equal(result.state,'COMPLETED');assert.deepEqual(c.calls.map(r=>r.operation),['DELETE','UPSERT']);assert.equal(c.cloud.get('A:a').deleted,true);
});
test('pending DELETE backoff defers new CREATE without reserving it; targeted push also respects barrier',async()=>{
 const c=context();await c.outbox.enqueue({entityType:'balloon',entityId:'a',operation:'DELETE'});const b=await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT'});const [a]=await c.outbox.list();await c.outbox.updateMutation(a.mutationId,{nextAttemptAt:'2099-01-01',lastErrorCode:'NETWORK'});
 assert.equal((await c.service.syncPendingMutations()).state,'PENDING');await c.service.syncMutationById(b.mutationId);assert.equal(c.calls.length,0);assert.equal((await c.outbox.list()).find(m=>m.entityId==='b').attempts,0);
});
test('existing UPDATE followed by own DELETE stays in order; not a creation barrier deadlock',async()=>{
 const c=context();c.cloud.set('A:a',{registration:'F-ABCD',revision:0,deleted:false});await c.outbox.setMetadata({entityType:'balloon',entityId:'a',revision:0,updatedAt:at});
 await c.outbox.enqueue({entityType:'balloon',entityId:'a',operation:'UPSERT'});const [edit]=await c.outbox.list();await c.outbox.markAttempt(edit.mutationId);await c.outbox.freezePayload(edit.mutationId,{serverEntityType:'balloon',serverEntityId:'a',payload:{registration:'F-ABCD'}});
 await c.outbox.enqueue({entityType:'balloon',entityId:'a',operation:'DELETE'});
 await c.service.syncPendingMutations();assert.deepEqual(c.calls.map(r=>r.operation),['UPSERT','DELETE']);
});
test('other SQL errors remain SERVER backoff, never a registration conflict',async()=>{
 const c=context();c.deps.applyMutation=async()=>{throw new CloudSyncTransportError('SERVER','another unique constraint');};await c.outbox.enqueue({entityType:'balloon',entityId:'b',operation:'UPSERT'});
 assert.equal((await c.service.syncPendingMutations()).state,'STOPPED_ERROR');const [m]=await c.outbox.list();assert.equal(m.lastErrorCode,'SERVER');assert.ok(m.nextAttemptAt);assert.equal((await c.issues.list()).length,0);
});
test('SQL normalization map matches ECMAScript uppercase exhaustively; precheck uses same mapping',async()=>{
 const migration=await readFile('supabase/migrations/20260918120000_balloon_registration_uniqueness.sql','utf8'),query=await readFile('supabase/queries/c11_balloon_registration_precheck.sql','utf8');
 const mappingText=migration.split('$uppercase$')[1];assert.equal(query.split('$uppercase$')[1],mappingText);const map=JSON.parse(mappingText);
 for(let cp=0;cp<=0x10ffff;cp++){if(cp>=0xd800&&cp<=0xdfff)continue;const ch=String.fromCodePoint(cp);assert.equal(map[ch]??ch,ch.toUpperCase());}
 const guard='do $guard$'+migration.split('do $guard$')[1].split('$guard$;')[0]+'$guard$;';assert.ok((await readFile('supabase/tests/cloud_sync_balloon_registration.test.sql','utf8')).includes(guard));
 assert.match(migration,/where deleted_at is null/);assert.match(migration,/violated_constraint = 'balloons_user_registration_active_key'/);assert.match(migration,/violated_table = 'balloons' and violated_schema = 'public'/);
});
