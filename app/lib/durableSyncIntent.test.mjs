import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { withSyncIntents, pendingSyncIntents, recoverLocalStorageSyncIntents, recoverIndexedDbSyncIntents, writeBusinessValueWithSync, putIndexedDbWithSyncIntents, LOCAL_SYNC_DELETED, isLocalSyncRecoveryRunning } from "./durableSyncIntent.ts";
import { MemorySyncOutboxStorage, IndexedDbSyncOutboxStorage, enqueueLocalSyncMutation } from "./syncOutbox.ts";
import { getRuntimeDataScope, setRuntimeAuthSnapshot, scopedIndexedDbName, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { CloudSyncService } from "./cloudSyncService.ts";
import { savePilotProfile, loadPilotProfile } from "./pilotProfileStorage.ts";
import { saveWeatherPreferences, loadWeatherPreferences } from "./weatherPreferencesStorage.ts";
import { saveUnitPreferences, loadUnitPreferences } from "./unitPreferencesStorage.ts";
import { DEFAULT_UNIT_PREFERENCES } from "./unitPreferences.ts";
import { saveAviationPreferences, loadAviationPreferences } from "./aviation/aviationPreferencesStorage.ts";
import { saveFavoriteLaunchSites, loadFavoriteLaunchSites } from "./favoriteLaunchSites.ts";
import { saveFavoriteWeatherPlaces, loadFavoriteWeatherPlaces } from "./favoriteWeatherPlaces.ts";
import { persistManualOfficialAscension, saveFlightCompletionState, loadFlightCompletionState } from "./flightCompletionStorage.ts";
import { defaultOfficialAscensionInput } from "./flightCompletion.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { addBalloon, editBalloon, deleteBalloon, setActiveBalloon, loadBalloonRegistry } from "./balloonStorage.ts";
import { REGISTERED_BALLOONS } from "./balloons.ts";
import { createEmptyPilotQualificationsState, savePilotQualifications } from "./pilotQualificationsStorage.ts";
import { IndexedDbBalloonDocumentStorage, BALLOON_DOCUMENT_DB_NAME } from "./balloonDocumentStorage.ts";
const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function memoryStorage() {
  const values = new Map(); return { fail: false, get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key),
    setItem(key, value) { if (this.fail) throw new Error("quota"); values.set(key, value); } };
}
function setup(t) {
  const storage = memoryStorage();
  const descriptors = Object.fromEntries(["window", "localStorage", "indexedDB"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, dispatchEvent: () => true } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: scope.slice(5), email: "test@example.com", firstName: "", lastName: "" } });
  t.after(() => { for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } setRuntimeAuthSnapshot({state:"UNKNOWN",user:null}); });
  return storage;
}
const change = (operation = "UPSERT") => ({ entityType: "pilot-profile", entityId: "singleton", operation });
const profile = (firstName) => ({ version: 1, firstName, lastName: "Pilote", licenseNumber: "", usualFunction: null, flightTestDueDateIso: "", medicalDueDateIso: "" });
function intents(storage) { return Array.from({length:storage.length},(_,i)=>pendingSyncIntents(JSON.parse(storage.getItem(storage.key(i))))).flat(); }
function failingOutbox(base) { return new Proxy(base, { get(target, key) { if (key === "enqueue") return async () => { throw new Error("IndexedDB offline"); }; const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } }); }

test("création locale + enqueue réussi : intention transférée, donnée intacte", async (t) => {
  const storage = setup(t), outbox = new MemorySyncOutboxStorage();
  savePilotProfile(profile("A")); await recoverLocalStorageSyncIntents(storage, scope, outbox);
  assert.equal(loadPilotProfile().firstName, "A"); assert.equal(intents(storage).length, 0);
  assert.equal((await outbox.list()).length, 1);
});
test("création + enqueue échoué : donnée et intention restent durables", async (t) => {
  const storage = setup(t), outbox = new MemorySyncOutboxStorage();
  savePilotProfile(profile("A")); assert.equal(await enqueueLocalSyncMutation("pilot-profile","singleton"),false);
  await assert.rejects(recoverLocalStorageSyncIntents(storage, scope, failingOutbox(outbox)));
  assert.equal(loadPilotProfile().firstName,"A"); assert.equal(intents(storage).length,1); assert.equal((await outbox.list()).length,0);
});
test("recovery C2 pendante expire, libère l'activité et conserve l'intention", async (t) => {
  const storage = setup(t), outbox = new MemorySyncOutboxStorage();
  savePilotProfile(profile("A"));
  let release;
  const hanging = new Proxy(outbox, { get(target, key) { if (key === "enqueue") return () => new Promise(resolve => { release = resolve; }); const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } });
  const operation = recoverLocalStorageSyncIntents(storage, scope, hanging, undefined, 5);
  await assert.rejects(operation, /SYNC_INTENT_RECOVERY_TIMEOUT/);
  assert.equal(isLocalSyncRecoveryRunning(scope), false);
  assert.equal(intents(storage).length, 1);
  assert.equal((await outbox.list()).length, 0);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
});
test("enqueue C2 commité après timeout reste idempotent puis nettoie au passage suivant", async (t) => {
  const storage = setup(t), outbox = new MemorySyncOutboxStorage();
  savePilotProfile(profile("A"));
  let release;
  const delayed = new Proxy(outbox, { get(target, key) { if (key === "enqueue") return async (intent) => { await new Promise(resolve => { release = resolve; }); return target.enqueue(intent); }; const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } });
  const recovery = recoverLocalStorageSyncIntents(storage, scope, delayed, undefined, 5);
  await assert.rejects(recovery, /SYNC_INTENT_RECOVERY_TIMEOUT/);
  assert.equal(intents(storage).length, 1);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await outbox.list()).length, 1);
  await recoverLocalStorageSyncIntents(storage, scope, outbox);
  assert.equal((await outbox.list()).length, 1);
  assert.equal(intents(storage).length, 0);
});
test("update après sidecar existant + échec + nouvelle instance : récupération de B", async (t) => {
  const storage = setup(t), mutations = new Map(), metadata = new Map();
  let outbox = new MemorySyncOutboxStorage({mutations,metadata});
  await outbox.setMetadata({entityType:"pilot-profile",entityId:"singleton",revision:7,updatedAt:"2026-09-01T12:00:00Z"});
  savePilotProfile(profile("B")); await assert.rejects(recoverLocalStorageSyncIntents(storage,scope,failingOutbox(outbox)));
  outbox = new MemorySyncOutboxStorage({mutations,metadata}); await recoverLocalStorageSyncIntents(storage,scope,outbox);
  assert.equal(loadPilotProfile().firstName,"B"); assert.equal((await outbox.list())[0].baseRevision,7); assert.equal(intents(storage).length,0);
});
test("delete favori + échec + redémarrage : DELETE reconstructible malgré disparition de l’entité", async (t) => {
  const storage = setup(t), outbox = new MemorySyncOutboxStorage();
  const favorite={id:"favorite-a",name:"A",latitude:50,longitude:3,createdAt:"2026-09-01T12:00:00Z",updatedAt:"2026-09-01T12:00:00Z"};
  saveFavoriteWeatherPlaces([favorite]); await recoverLocalStorageSyncIntents(storage,scope,outbox);
  const a=(await outbox.list())[0]; await outbox.acknowledge(a.mutationId,{entityType:a.entityType,entityId:a.entityId,revision:1,updatedAt:a.createdAt});
  saveFavoriteWeatherPlaces([]); await assert.rejects(recoverLocalStorageSyncIntents(storage,scope,failingOutbox(outbox)));
  assert.deepEqual(loadFavoriteWeatherPlaces(),[]); assert.equal(intents(storage)[0].operation,"DELETE");
  await recoverLocalStorageSyncIntents(storage,scope,outbox); assert.equal((await outbox.list())[0].operation,"DELETE"); assert.equal((await outbox.list())[0].baseRevision,1);
});
test("création puis suppression avant récupération : aucun UPSERT orphelin bloquant", async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage();
  writeBusinessValueWithSync(storage,"aggregate",JSON.stringify({items:[{id:"a"}]}),[change()]);
  writeBusinessValueWithSync(storage,"aggregate",JSON.stringify({items:[]}),[change("DELETE")]);
  await recoverLocalStorageSyncIntents(storage,scope,outbox);
  assert.equal((await outbox.list()).length,1); assert.equal((await outbox.list())[0].operation,"DELETE");
});
test("échec de nettoyage du marqueur : replay idempotent, sans reset du snapshot B5", async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage(); savePilotProfile(profile("A")); storage.fail=true;
  await assert.rejects(recoverLocalStorageSyncIntents(storage,scope,outbox)); storage.fail=false;
  const a=(await outbox.list())[0]; await outbox.markAttempt(a.mutationId);
  await outbox.freezePayload(a.mutationId,{serverEntityType:"profile",serverEntityId:"singleton",payload:{first_name:"A"}});
  await recoverLocalStorageSyncIntents(storage,scope,outbox);
  assert.equal((await outbox.list()).length,1); assert.equal((await outbox.list())[0].attempts,1);
  assert.equal((await outbox.list())[0].payloadSnapshot.payload.first_name,"A");
});
test("compatibilité B5 : édition B pendant envoi A, recovery final garde B pending",async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage(); let cloud=null,rev=0,once=true;
  const service=new CloudSyncService({outbox,getScope:getRuntimeDataScope,getOnlineUserId:async()=>scope.slice(5),recoverLocalMutations:()=>recoverLocalStorageSyncIntents(storage,scope,outbox).then(()=>undefined),
    buildPayload:async()=>({serverEntityType:"profile",serverEntityId:"singleton",payload:{first_name:loadPilotProfile().firstName}}),
    applyMutation:async(request)=>{cloud=request.payload.first_name;if(once){once=false;savePilotProfile(profile("B"));}return {status:"APPLIED",entityId:request.entityId,revision:++rev,serverUpdatedAt:new Date().toISOString(),deletedAt:null};},
    issues:{remove:async()=>undefined}});
  savePilotProfile(profile("A"));assert.equal((await service.syncPendingMutations()).state,"PENDING");
  assert.equal(loadPilotProfile().firstName,"B");assert.equal(cloud,"A");assert.equal((await outbox.list()).length,1);
  assert.equal((await service.syncPendingMutations()).state,"COMPLETED");assert.equal(cloud,"B");assert.equal((await outbox.list()).length,0);
});
test("échec localStorage : ni nouvelle donnée, ni intention, ni faux résultat de sauvegarde",async(t)=>{
  const storage=setup(t);storage.fail=true;assert.throws(()=>savePilotProfile(profile("A")),/quota/);
  assert.equal(loadPilotProfile().firstName,"");assert.equal(intents(storage).length,0);
  assert.throws(()=>persistManualOfficialAscension(defaultOfficialAscensionInput()),/Enregistrement local/);
});
test("préférences et carnet : updates/suppressions conservent leurs intentions",async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage();
  assert.equal(saveWeatherPreferences({favoriteWeatherLocationId:null,weatherModel:"gfs_seamless"}),true);
  assert.equal(saveUnitPreferences(DEFAULT_UNIT_PREFERENCES),true);saveAviationPreferences("LFQQ",[]);
  assert.equal(loadWeatherPreferences().weatherModel,"gfs_seamless");assert.ok(loadUnitPreferences());assert.equal(loadAviationPreferences().airportIcao,"LFQQ");
  const state=persistManualOfficialAscension(defaultOfficialAscensionInput()); const id=state.officialAscensions[0].id;
  await recoverLocalStorageSyncIntents(storage,scope,outbox); assert.ok((await outbox.list()).some(m=>m.entityType==="logbook-entry"&&m.entityId===id));
  saveFlightCompletionState({...loadFlightCompletionState(),officialAscensions:[]});
  assert.ok(intents(storage).some(m=>m.entityType==="logbook-entry"&&m.operation==="DELETE"));
});
test("une autre écriture du même agrégat ne supprime pas les intentions existantes",async(t)=>{
  const storage=setup(t);writeBusinessValueWithSync(storage,"aggregate",JSON.stringify({a:1}),[change()]);
  writeScopedBusinessValue(storage,"aggregate",JSON.stringify({a:2}));assert.equal(intents(storage).length,1);
});
function transactionalDatabase() {
  let stores = new Map(["mutations", "metadata", "documents", "files", "flights", "activeFlight"].map((name) => [name, new Map()]));
  const transactions = []; let busy = false;
  const database = {
    onGetAll: null, onGet: null, abortNext: false,
    transaction(names, mode) {
      const operations = []; let working, aborted = false;
      const tx = {
        error: null, abort() { aborted = true; tx.error = new Error("transaction aborted"); },
        objectStore(name) {
          const request = (operation) => { const result = {}; operations.push(() => {
            result.result = operation(working.get(name));
            result.onsuccess?.();
          }); return result; };
          return {
            openCursor() {
              const result={}; let values,index=0;
              const next=()=>operations.push(()=>{values??=[...working.get(name).values()];result.result=index<values.length?{value:structuredClone(values[index++]),continue:next}:null;result.onsuccess?.();});
              next();return result;
            },
            add(value) { return this.put(value); },
            index() { return { getAll: (balloonId) => request((store) => structuredClone([...store.values()].filter(value=>value.balloonId===balloonId))) }; },
            get: (key) => request((store) => { const value = structuredClone(store.get(JSON.stringify(key))); database.onGet?.(name, mode); return value; }),
            getAll: () => request((store) => { const values = structuredClone([...store.values()]); database.onGetAll?.(); return values; }),
            put(value) { const copy = structuredClone(value); return request((store) => store.set(JSON.stringify(name === "mutations" ? copy.mutationId : name === "metadata" ? [copy.entityType, copy.entityId] : name === "files" ? copy.documentId : copy.id), copy)); },
            delete: (key) => request((store) => store.delete(JSON.stringify(key))),
          };
        },
      };
      transactions.push(() => {
        working = structuredClone(stores);
        const abortAtCommit = mode === "readwrite" && database.abortNext;
        if (abortAtCommit) database.abortNext = false;
        const step = () => {
          if (!aborted && operations.length) { operations.shift()(); queueMicrotask(step); return; }
          if (abortAtCommit) tx.abort();
          if (aborted) tx.onabort?.();
          else { if (mode === "readwrite") stores = working; tx.oncomplete?.(); }
          busy = false; start();
        };
        queueMicrotask(step);
      });
      queueMicrotask(start); return tx;
    },
  };
  function start() { if (!busy && transactions.length) { busy = true; transactions.shift()(); } }
  return database;
}

function documentStore(database) { const docs=new IndexedDbBalloonDocumentStorage({});docs.databasePromises.set(scopedIndexedDbName(scope,BALLOON_DOCUMENT_DB_NAME),Promise.resolve(database));return docs; }
test("documents : création avec fichier, update et delete restent récupérables après échec outbox et redémarrage",async(t)=>{
  setup(t);const db=transactionalDatabase(),outbox=new MemorySyncOutboxStorage();let docs=documentStore(db);
  const document=await docs.addDocument({balloonId:"balloon-a",category:"INSURANCE",title:"A"},new File(["pdf"],"test.pdf",{type:"application/pdf"}));
  assert.equal((await docs.getDocumentFile(document.id)).size,3);
  await assert.rejects(docs.recoverSyncIntents(scope,failingOutbox(outbox)));
  docs=documentStore(db);await docs.recoverSyncIntents(scope,outbox);const a=(await outbox.list())[0];
  await outbox.acknowledge(a.mutationId,{entityType:a.entityType,entityId:a.entityId,revision:2,updatedAt:a.createdAt});
  await docs.updateDocument(document.id,{title:"B"});await assert.rejects(docs.recoverSyncIntents(scope,failingOutbox(outbox)));
  docs=documentStore(db);assert.equal((await docs.getDocument(document.id)).title,"B");await docs.recoverSyncIntents(scope,outbox);
  const b=(await outbox.list())[0];assert.equal(b.baseRevision,2);await outbox.acknowledge(b.mutationId,{entityType:b.entityType,entityId:b.entityId,revision:3,updatedAt:b.createdAt});
  await docs.deleteDocument(document.id);assert.equal(await docs.getDocument(document.id),null);assert.equal(await docs.getDocumentFile(document.id),null);assert.equal(await docs.countByBalloonId("balloon-a"),0);
  await assert.rejects(docs.recoverSyncIntents(scope,failingOutbox(outbox)));docs=documentStore(db);await docs.recoverSyncIntents(scope,outbox);
  assert.equal((await outbox.list())[0].operation,"DELETE");assert.equal((await outbox.list())[0].baseRevision,3);assert.deepEqual(await docs.listDocuments(),[]);
});
test("documents : abort de la transaction métier ne confirme ni fichier ni métadonnée",async(t)=>{
  setup(t);const db=transactionalDatabase(),docs=documentStore(db);db.abortNext=true;
  await assert.rejects(docs.addDocument({balloonId:"balloon-a",category:"INSURANCE",title:"A"},new File(["pdf"],"test.pdf",{type:"application/pdf"})));
  assert.deepEqual(await docs.listDocuments(),[]);
  await recoverIndexedDbSyncIntents(db,"documents",scope,new MemorySyncOutboxStorage());
});
test("IndexedDB : une nouvelle intention pendant transfert ne disparaît pas avec l’ancienne",async(t)=>{
  setup(t);const db=transactionalDatabase();
  const put=(value)=>new Promise(resolve=>{const tx=db.transaction("documents","readwrite");tx.objectStore("documents").put(value);tx.oncomplete=resolve;});
  await put(withSyncIntents({id:"a"},[change()]));
  const base=new MemorySyncOutboxStorage();let once=true;
  const outbox=new Proxy(base,{get(target,key){if(key==="enqueue")return async(input)=>{const result=await target.enqueue(input);if(once){once=false;await put(withSyncIntents({id:"a",[LOCAL_SYNC_DELETED]:true},[change("DELETE")]));}return result;};const value=target[key];return typeof value==="function"?value.bind(target):value;}});
  await recoverIndexedDbSyncIntents(db,"documents",scope,outbox);await recoverIndexedDbSyncIntents(db,"documents",scope,outbox);
  assert.equal((await base.list())[0].operation,"DELETE");
});

for (const backend of ["memory", "indexedDB"]) test(`${backend} : replay d’une intention déjà acquittée n’ajoute aucune mutation`,async(t)=>{
  setup(t); let outbox;
  if(backend==="memory")outbox=new MemorySyncOutboxStorage();
  else {Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{}});outbox=new IndexedDbSyncOutboxStorage(scope);outbox.databasePromise=Promise.resolve(transactionalDatabase());}
  const input={...change(),mutationId:crypto.randomUUID()};await outbox.enqueue(input);
  const a=(await outbox.list())[0];await outbox.markAttempt(a.mutationId);await outbox.freezePayload(a.mutationId,{serverEntityType:"profile",serverEntityId:"singleton",payload:{first_name:"A"}});
  await outbox.acknowledge(a.mutationId,{entityType:a.entityType,entityId:a.entityId,revision:1,updatedAt:a.createdAt});
  await outbox.setMetadata({entityType:a.entityType,entityId:a.entityId,revision:2,updatedAt:a.createdAt});
  await outbox.enqueue(input);assert.deepEqual(await outbox.list(),[]);assert.equal((await outbox.getMetadata(a.entityType,a.entityId)).revision,2);
});
test("échec de récupération avant push : aucun envoi ni faux COMPLETED",async(t)=>{
  setup(t);let requests=0;
  const service=new CloudSyncService({outbox:new MemorySyncOutboxStorage(),issues:{},getScope:getRuntimeDataScope,getOnlineUserId:async()=>scope.slice(5),
    recoverLocalMutations:async()=>{throw new Error("quota");},applyMutation:async()=>{requests++;},buildPayload:async()=>null});
  assert.equal((await service.syncPendingMutations()).state,"STOPPED_ERROR");assert.equal(requests,0);
});

test("ballons et qualifications : succès local durable même si l’outbox est indisponible",async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage();
  const input={...REGISTERED_BALLOONS[0],registration:"F-TEST"};const balloon=await addBalloon(input);assert.ok(balloon);
  await editBalloon(balloon.id,{...input,model:"B"});setActiveBalloon(balloon.id);
  assert.equal(loadBalloonRegistry().balloons[0].model,"B");assert.ok(intents(storage).some(m=>m.entityType==="balloon-preferences"));
  assert.equal(savePilotQualifications(createEmptyPilotQualificationsState(),storage),true);
  await deleteBalloon(balloon.id);assert.equal(loadBalloonRegistry().balloons.length,0);
  await recoverLocalStorageSyncIntents(storage,scope,outbox);
  assert.equal((await outbox.list()).find(m=>m.entityType==="balloon").operation,"DELETE");
  assert.ok((await outbox.list()).some(m=>m.entityType==="pilot-qualifications"));
});
test("vol persisté : updates et delete conservent des intentions après échec outbox",async(t)=>{
  setup(t);Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{}});
  const db=transactionalDatabase(),outbox=new MemorySyncOutboxStorage();
  const create=()=>{const flights=new IndexedDbRecordedFlightStorage();flights.databasePromise=Promise.resolve(db);flights.scope=scope;return flights;};
  let flights=create();const now=Date.now();const flight={id:"flight-a",schemaVersion:1,status:"COMPLETED",startedAt:now-1000,endedAt:now,points:[],summary:{durationSeconds:1,distanceMeters:0,minAltitudeMeters:null,maxAltitudeMeters:null,averageGroundSpeedMetersPerSecond:null,maxGroundSpeedMetersPerSecond:null},createdAt:now,updatedAt:now};
  await flights.completeFlight(flight);await flights.recoverSyncIntents(scope,outbox);
  let mutation=(await outbox.list())[0];await outbox.acknowledge(mutation.mutationId,{entityType:mutation.entityType,entityId:mutation.entityId,revision:1,updatedAt:mutation.createdAt});
  await flights.updateFlightLocations(flight.id,{departureLocationLabel:"B"});await flights.updateFlightNotes(flight.id,"notes B");
  await assert.rejects(flights.recoverSyncIntents(scope,failingOutbox(outbox)));flights=create();assert.equal((await flights.getFlight(flight.id)).notes,"notes B");
  await flights.recoverSyncIntents(scope,outbox);mutation=(await outbox.list())[0];assert.equal(mutation.baseRevision,1);
  await outbox.acknowledge(mutation.mutationId,{entityType:mutation.entityType,entityId:mutation.entityId,revision:2,updatedAt:mutation.createdAt});
  await assert.rejects(flights.deleteFlight(flight.id)); // Existing trace-job storage also unavailable.
  assert.equal(await flights.getFlight(flight.id),null);await assert.rejects(flights.recoverSyncIntents(scope,failingOutbox(outbox)));
  flights=create();await flights.recoverSyncIntents(scope,outbox);assert.equal((await outbox.list())[0].operation,"DELETE");assert.equal((await outbox.list())[0].baseRevision,2);
});

test("chemin runtime : création locale et enqueue IndexedDB réussi",async(t)=>{
  const storage=setup(t),db=transactionalDatabase();
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}}});
  savePilotProfile(profile("A"));assert.equal(await enqueueLocalSyncMutation("pilot-profile","singleton"),true);
  const outbox=new IndexedDbSyncOutboxStorage(scope);outbox.databasePromise=Promise.resolve(db);
  assert.equal((await outbox.list()).length,1);assert.equal(intents(storage).length,0);assert.equal(loadPilotProfile().firstName,"A");
});

test("enqueue retardé après transfert et acquittement : ne recrée pas une mutation déjà terminée",async(t)=>{
  const storage=setup(t),db=transactionalDatabase();
  let reached,release,done,count=0;
  const opened=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;}),finished=new Promise(resolve=>{done=resolve;});
  const mainScope="USER:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let first=true;
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request={};const wait=first?gate:Promise.resolve();if(first){first=false;reached();}wait.then(()=>{request.result=db;request.onsuccess?.();});return request;}}});
  window.dispatchEvent=()=>{if(++count===2)done();return true;};
  setRuntimeAuthSnapshot({state:"SIGNED_IN",user:{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}});
  const blocking=enqueueLocalSyncMutation("balloon","blocking");await opened;
  setRuntimeAuthSnapshot({state:"SIGNED_IN",user:{id:mainScope.slice(5)}});savePilotProfile(profile("A"));
  const outbox=new IndexedDbSyncOutboxStorage(mainScope);outbox.databasePromise=Promise.resolve(db);
  await recoverLocalStorageSyncIntents(storage,mainScope,outbox);
  const a=(await outbox.list())[0];await outbox.markAttempt(a.mutationId);
  await outbox.freezePayload(a.mutationId,{serverEntityType:"profile",serverEntityId:"singleton",payload:{first_name:"A"}});
  await outbox.acknowledge(a.mutationId,{entityType:a.entityType,entityId:a.entityId,revision:1,updatedAt:a.createdAt});
  release();await blocking;await finished;
  assert.equal((await outbox.list()).filter(m=>m.entityType==="pilot-profile").length,0);
  assert.equal(intents(storage).length,0);
});

test("favoris de préparation : échec localStorage renvoie false et ne confirme aucune création",async(t)=>{
  const storage=setup(t);storage.fail=true;
  assert.equal(saveFavoriteLaunchSites([{id:"launch-a",name:"A",latitude:50,longitude:3,createdAt:new Date().toISOString()}]),false);
  assert.deepEqual(loadFavoriteLaunchSites(),[]);assert.equal(intents(storage).length,0);
});

test("DELETE terminal NOT_FOUND : diagnostic conservé et intention durable acquittée sans ré-enqueue",async(t)=>{
  const storage=setup(t),outbox=new MemorySyncOutboxStorage();
  writeBusinessValueWithSync(storage,"deleted",JSON.stringify({items:[]}),[change("DELETE")]);
  const intent=intents(storage)[0];let issues=0;
  const service=new CloudSyncService({outbox,getScope:getRuntimeDataScope,getOnlineUserId:async()=>scope.slice(5),
    recoverLocalMutations:()=>recoverLocalStorageSyncIntents(storage,scope,outbox).then(()=>undefined),
    buildPayload:async()=>({serverEntityType:"profile",serverEntityId:"singleton",payload:{}}),
    applyMutation:async()=>({status:"NOT_FOUND",entityId:"singleton",revision:null,serverUpdatedAt:null,deletedAt:null}),issues:{save:async()=>{issues++;}}});
  const result=await service.syncPendingMutations();assert.equal(result.state,"COMPLETED");assert.equal(result.notFound,1);assert.equal(issues,1);
  await outbox.enqueue(intent);assert.deepEqual(await outbox.list(),[]);
});

const identityB = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function switchIdentity(next) { setRuntimeAuthSnapshot(next ? {state:"SIGNED_IN",user:{id:next.slice(5)}} : {state:"SIGNED_OUT",user:null}); }
function seed(db, storeName, value) { return new Promise(resolve=>{const tx=db.transaction(storeName,"readwrite");tx.objectStore(storeName).put(value);tx.oncomplete=resolve;}); }
for (const operation of ["UPSERT", "DELETE"]) test(`${operation} IndexedDB sous A + logout pendant callback : intention durable dans A`, async(t)=>{
  setup(t);const db=transactionalDatabase(), outbox=new MemorySyncOutboxStorage();
  await seed(db,"documents",{id:"doc-a",title:"A"});
  db.onGet=(name,mode)=>{if(name==="documents"&&mode==="readwrite")switchIdentity(null);};
  await new Promise(resolve=>{const tx=db.transaction("documents","readwrite");putIndexedDbWithSyncIntents(tx.objectStore("documents"),operation==="DELETE"?{id:"doc-a",[LOCAL_SYNC_DELETED]:true}:{id:"doc-a",title:"B"},[{entityType:"balloon-document",entityId:"doc-a",operation}],scope);tx.oncomplete=resolve;});
  switchIdentity(identityB);const other=new MemorySyncOutboxStorage();
  await assert.rejects(recoverIndexedDbSyncIntents(db,"documents",scope,other));assert.deepEqual(await other.list(),[]);
  db.onGet=null;switchIdentity(scope);await recoverIndexedDbSyncIntents(db,"documents",scope,outbox);
  assert.equal((await outbox.list())[0].operation,operation);
});
test("instance vol A après passage à B : aucun replay vers B ni vers une destination incohérente",async(t)=>{
  setup(t);Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{}});const db=transactionalDatabase();
  await seed(db,"flights",withSyncIntents({id:"flight-a"},[{entityType:"flight",entityId:"flight-a",operation:"UPSERT"}]));
  const flights=new IndexedDbRecordedFlightStorage();flights.scope=scope;flights.databasePromise=Promise.resolve(db);
  switchIdentity(identityB);const other=new MemorySyncOutboxStorage();
  await assert.rejects(flights.recoverSyncIntents(identityB,other),/SCOPE_MISMATCH/);assert.deepEqual(await other.list(),[]);
  switchIdentity(scope);await assert.rejects(flights.recoverSyncIntents(scope,other),/SCOPE_MISMATCH/);
  const own=new MemorySyncOutboxStorage();await flights.recoverSyncIntents(scope,own);assert.equal((await own.list()).length,1);
});
for(const transition of ["A->B","A->A","A->B->A","logout->B"]) test(`document update ${transition} entre lecture et écriture : base/intention A conservées`,async(t)=>{
  setup(t);const a=transactionalDatabase(),b=transactionalDatabase(),docs=documentStore(a);
  docs.databasePromises.set(scopedIndexedDbName(identityB,BALLOON_DOCUMENT_DB_NAME),Promise.resolve(b));
  await seed(a,"documents",{id:"doc-a",balloonId:"balloon-a",title:"A"});
  const original=docs.getDocument.bind(docs);
  docs.getDocument=async(...args)=>{const current=await original(...args);if(transition==="A->A")switchIdentity(scope);else if(transition==="logout->B"){switchIdentity(null);switchIdentity(identityB);}else{switchIdentity(identityB);if(transition==="A->B->A")switchIdentity(scope);}return current;};
  await docs.updateDocument("doc-a",{title:"updated-A"});docs.getDocument=original;
  switchIdentity(identityB);assert.deepEqual(await docs.listDocuments(),[]);const other=new MemorySyncOutboxStorage();await docs.recoverSyncIntents(identityB,other);assert.deepEqual(await other.list(),[]);
  switchIdentity(scope);const current=await docs.getDocument("doc-a");assert.equal(current.title,"updated-A");assert.equal(pendingSyncIntents(current).length,1);
  const own=new MemorySyncOutboxStorage();await docs.recoverSyncIntents(scope,own);assert.equal((await own.list()).length,1);
});

test("DELETE document sous A + logout dans callback : tombstone caché et récupération sûre après retour A",async(t)=>{
  setup(t);const db=transactionalDatabase(),docs=documentStore(db),outbox=new MemorySyncOutboxStorage();
  await seed(db,"documents",{id:"doc-a",balloonId:"balloon-a",title:"A"});
  db.onGet=(name,mode)=>{if(name==="documents"&&mode==="readwrite")switchIdentity(null);};
  await docs.deleteDocument("doc-a");db.onGet=null;switchIdentity(scope);
  assert.equal(await docs.getDocument("doc-a"),null);assert.deepEqual(await docs.listDocuments(),[]);
  await assert.rejects(docs.recoverSyncIntents(scope,failingOutbox(outbox)));
  const read=()=>new Promise(resolve=>{const request=db.transaction("documents").objectStore("documents").get("doc-a");request.onsuccess=()=>resolve(request.result);});
  assert.equal(pendingSyncIntents(await read())[0].operation,"DELETE");
  await docs.recoverSyncIntents(scope,outbox);assert.equal(await read(),undefined);assert.equal((await outbox.list())[0].operation,"DELETE");
});
test("UPDATE notes vol A + logout dans callback : intention et valeur A conservées",async(t)=>{
  setup(t);Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{}});
  const db=transactionalDatabase(),flights=new IndexedDbRecordedFlightStorage();flights.scope=scope;flights.databasePromise=Promise.resolve(db);
  const now=Date.now();await seed(db,"flights",{id:"flight-a",schemaVersion:1,status:"COMPLETED",startedAt:now,endedAt:now,points:[],summary:{durationSeconds:0,distanceMeters:0,minAltitudeMeters:null,maxAltitudeMeters:null,averageGroundSpeedMetersPerSecond:null,maxGroundSpeedMetersPerSecond:null},createdAt:now,updatedAt:now});
  db.onGet=(name,mode)=>{if(name==="flights"&&mode==="readwrite")switchIdentity(null);};
  await flights.updateFlightNotes("flight-a","notes-A");db.onGet=null;switchIdentity(scope);
  const current=await flights.getFlight("flight-a");assert.equal(current.notes,"notes-A");assert.equal(pendingSyncIntents(current).length,1);
});
