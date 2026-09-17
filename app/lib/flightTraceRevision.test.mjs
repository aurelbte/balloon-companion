import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import { BrowserFlightTrackCloudService } from "./flightTrackCloudBrowser.ts";
import { CloudSyncService } from "./cloudSyncService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260917120000_flights_trace_metadata_revision.sql", import.meta.url), "utf8");
const technical = ["storage_provider", "object_key", "format_version", "checksum", "blob_status", "blob_size", "track_generation"];
const scope = "USER:user-a";
afterEach(() => setRuntimeAuthSnapshot({state:"UNKNOWN",user:null}));

// Integration double for the server semantics. Actual PostgreSQL trigger/RPC
// assertions are separately provided in supabase/tests/cloud_sync_trace_revision.test.sql.
function fixture(options = {}) {
  setRuntimeAuthSnapshot({state:"SIGNED_IN",user:{id:"user-a"}});
  const row = {id:"flight-a",user_id:"user-a",revision:7,created_at:"2026-09-01T10:00:00Z",updated_at:"2026-09-01T10:00:00Z",notes:"A",deleted_at:null,object_key:null,checksum:null,blob_size:null,blob_status:"LOCAL_ONLY",storage_provider:null,track_generation:1};
  const outbox = new MemorySyncOutboxStorage();
  const comparable = value => Object.fromEntries(Object.entries(value).filter(([key])=>!technical.includes(key)));
  let clock = 0, lost = options.lostResponse ?? false, failed = options.failBeforeUpdate ?? false, uploads = 0;
  function update(patch) {
    const next={...row,...patch,created_at:row.created_at};
    if(!assertDeepEqual(comparable(next),comparable(row))) { next.revision=row.revision+1;next.updated_at=new Date(Date.UTC(2026,8,17,12,0,++clock)).toISOString(); }
    Object.assign(row,next);
  }
  function query(mode="select",patch=null) {
    const filters=[];
    const chain={select:()=>chain,eq:(key,value)=>{filters.push(r=>r[key]===value);return chain;},is:(key,value)=>{filters.push(r=>r[key]===value);return chain;},not:(key,_operator,value)=>{filters.push(r=>r[key]!==value);return chain;},update:value=>query("update",value),
      maybeSingle:async()=>({data:filters.every(fn=>fn(row))?{...row}:null,error:null}),
      then(resolve,reject){return Promise.resolve().then(()=>{if(mode==="update"&&filters.every(fn=>fn(row))){if(failed){failed=false;throw new Error("network before update");}update(patch);if(lost){lost=false;throw new Error("lost metadata response");}}return {data:mode==="select"?[{...row}]:null,error:null};}).then(resolve,reject);}};
    return chain;
  }
  const flight={id:"flight-a",schemaVersion:1,status:"COMPLETED",startedAt:1000,endedAt:2000,createdAt:1000,updatedAt:2000,points:[{timestamp:1000,latitude:50,longitude:3,altitudeMeters:100,speedMetersPerSecond:2,headingDegrees:90,horizontalAccuracyMeters:5,verticalAccuracyMeters:8}],summary:{durationSeconds:1,distanceMeters:0,minAltitudeMeters:100,maxAltitudeMeters:100,averageGroundSpeedMetersPerSecond:2,maxGroundSpeedMetersPerSecond:2}};
  const storage={getFlight:async()=>structuredClone(flight),listFlights:async()=>[structuredClone(flight)],hydrateTrackFromCloudWithoutEnqueue:async()=>true};
  const r2={name:"R2",upload:async()=>{uploads++;options.onUpload?.();return {objectKey:"users/user-a/flights/flight-a/track-v1.json"};},delete:async()=>undefined};
  const tracks=new BrowserFlightTrackCloudService({from:()=>query()},scope,storage,{r2});
  const requests=[];let notes="B";
  const business=new CloudSyncService({outbox,getScope:()=>scope,getOnlineUserId:async()=>"user-a",issues:{remove:async()=>undefined,save:async()=>undefined},
    buildPayload:async()=>({serverEntityType:"flight",serverEntityId:"flight-a",payload:{notes}}),
    applyMutation:async request=>{requests.push(request);if(request.baseRevision!==row.revision||row.deleted_at)return {status:"CONFLICT",entityId:row.id,revision:row.revision,serverUpdatedAt:row.updated_at,deletedAt:row.deleted_at};update(request.payload);return {status:"APPLIED",entityId:row.id,revision:row.revision,serverUpdatedAt:row.updated_at,deletedAt:row.deleted_at};}});
  return {row,outbox,tracks,business,update,requests,uploads:()=>uploads,setNotes:value=>{notes=value;},seed:()=>outbox.setMetadata({entityType:"flight",entityId:row.id,revision:7,updatedAt:row.updated_at}),pending:()=>outbox.enqueue({entityType:"flight",entityId:row.id,operation:"UPSERT"})};
}
function assertDeepEqual(a,b) { try{assert.deepEqual(a,b);return true;}catch{return false;} }

test("migration : allowlist fermée exacte, fonction dédiée flights, ni RPC ni RLS modifiés",()=>{
  const arrays=[...migration.matchAll(/array\[([\s\S]*?)\]::text\[\]/g)].map(match=>[...match[1].matchAll(/'([^']+)'/g)].map(item=>item[1]));
  assert.deepEqual(arrays,[technical,technical]);
  assert.match(migration,/is not distinct from/);assert.match(migration,/new\.revision := old\.revision;/);assert.match(migration,/new\.updated_at := old\.updated_at;/);
  assert.match(migration,/else\s+new\.revision := old\.revision \+ 1;\s+new\.updated_at := statement_timestamp\(\);/);
  assert.match(migration,/drop trigger flights_touch_sync_row on public\.flights/);
  assert.doesNotMatch(migration,/create policy|alter table|security definer|apply_cloud_sync_mutation|create or replace function public\.balloon_companion_touch_sync_row\(/i);
});
test("tous les champs réellement écrits par upload, cleanup et transitions legacy sont dans l’allowlist",()=>{
  for(const file of ["flightTrackCloudBrowser.ts","flightTrackR2Server.ts"]){
    const code=readFileSync(new URL(file,import.meta.url),"utf8");const patches=[...code.matchAll(/\.update\(\{([^}]+)\}\)/g)];assert.ok(patches.length>=2);
    for(const patch of patches){const fields=patch[1].split(",").map(value=>value.trim()).filter(Boolean).map(value=>value.split(":")[0].trim());for(const field of fields)assert.ok(technical.includes(field),field);}
  }
});
test("upload puis mutation pending existante : base N conservée, succès N+1",async()=>{
  const f=fixture();await f.seed();await f.pending();const before=f.row.updated_at;
  await f.tracks.upload("flight-a");assert.equal(f.row.revision,7);assert.equal(f.row.updated_at,before);
  assert.equal((await f.outbox.list())[0].baseRevision,7);assert.equal((await f.business.syncPendingMutations()).state,"COMPLETED");assert.equal(f.row.revision,8);assert.notEqual(f.row.updated_at,before);
});
test("clear des métadonnées trace puis métier : aucune révision artificielle",async()=>{
  const f=fixture();await f.seed();await f.tracks.upload("flight-a");f.update({object_key:null,checksum:null,blob_size:null,blob_status:"LOCAL_ONLY",storage_provider:null,format_version:null});
  assert.equal(f.row.revision,7);await f.pending();assert.equal((await f.business.syncPendingMutations()).state,"COMPLETED");assert.equal(f.row.revision,8);
});
for(const batch of [false,true])test(`cleanup réel ${batch?"batch":"ciblé"} : tombstone/révision/date inchangés, résurrection refusée`,async()=>{
  const f=fixture();await f.tracks.upload("flight-a");f.update({deleted_at:"2026-09-17T10:00:00Z"});const revision=f.row.revision,date=f.row.updated_at;
  if(batch)await f.tracks.cleanupDeletedTracks();else await f.tracks.cleanup("flight-a");
  assert.equal(f.row.revision,revision);assert.equal(f.row.updated_at,date);assert.ok(f.row.deleted_at);assert.equal(f.row.object_key,null);
  await f.seed();await f.pending();assert.equal((await f.business.syncPendingMutations()).conflicts,1);
});
test("mixte métier/blob et future colonne métier : révision incrémentée",()=>{
  const f=fixture();f.update({notes:"mixed",blob_status:"READY"});assert.equal(f.row.revision,8);f.update({future_business_field:"changed",checksum:"new"});assert.equal(f.row.revision,9);
});
test("vraie modification concurrente pendant transport : conflit toujours détecté",async()=>{
  const f=fixture();await f.seed();await f.pending();await f.tracks.upload("flight-a");f.update({notes:"other pilot device"});
  assert.equal((await f.business.syncPendingMutations()).conflicts,1);assert.equal(f.row.notes,"other pilot device");assert.equal((await f.outbox.list()).length,1);
});
for(const lostResponse of [false,true])test(`retry blob ${lostResponse?"réponse perdue après succès":"échec avant metadata"} : pas de dérive de révision`,async()=>{
  const f=fixture(lostResponse?{lostResponse:true}:{failBeforeUpdate:true});await f.seed();await assert.rejects(f.tracks.upload("flight-a"));await f.tracks.upload("flight-a");await f.tracks.uploadToR2Targeted("flight-a");
  assert.equal(f.row.revision,7);assert.equal(f.row.updated_at,"2026-09-01T10:00:00Z");await f.pending();assert.equal((await f.business.syncPendingMutations()).state,"COMPLETED");assert.equal(f.row.revision,8);
});
test("changement de compte pendant upload : aucune finalisation metadata inter-compte",async()=>{
  const f=fixture({onUpload:()=>setRuntimeAuthSnapshot({state:"SIGNED_IN",user:{id:"user-b"}})});
  await assert.rejects(f.tracks.upload("flight-a"),/TRACK_USER_SWITCH/);assert.equal(f.row.revision,7);assert.equal(f.row.object_key,null);
});
