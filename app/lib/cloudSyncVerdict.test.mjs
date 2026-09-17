import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCloudSyncVerdict, cloudSyncVerdictGeneration, invalidateCloudSyncVerdict, cloudSyncObservationVersion, CloudSyncVerdictAcceptance } from './cloudSyncVerdict.ts';
import { CloudSyncRuntimeController } from './cloudSyncRuntimeController.ts';
import { countStoredSyncIntents, readExistingSyncStore } from './cloudSyncVerdictBrowser.ts';
import { setRuntimeAuthSnapshot } from './auth/dataScopeRuntime.ts';
const mutation = (extra={}) => ({ mutationId:'m',entityType:'flight',entityId:'f',operation:'UPSERT',attempts:0,baseRevision:1,createdAt:'2026-09-17',...extra });
const runtime = (extra={}) => ({scope:'USER:A',lastBootstrapState:'SUCCESS',lastPushState:'COMPLETED',lastPushCompletedAt:'2026-09-17T12:00:00Z',lastCompletedAt:'2026-09-17T11:59:00Z',lastError:null,bootstrapInProgress:false,pushInProgress:false,...extra});
const evidence = (extra={}) => ({mutations:[],intents:0,issues:[],tracks:[],traceActive:false,traceDiscoveryComplete:true,coverageComplete:true,passGeneration:0,...extra});
function fixture(r={},e={}) { let scope='USER:A',generation=0,online=true;return {input:{getScope:()=>scope,getGeneration:()=>generation,online:()=>online,runtime:()=>runtime(r),read:async()=>evidence(e)},changeScope:s=>scope=s,changeGeneration:()=>generation++,offline:()=>online=false}; }
async function state(r={},e={}) {return (await inspectCloudSyncVerdict(fixture(r,e).input)).state;}
for (const outcome of ['PENDING','STOPPED_ERROR','THROW']) test(`service ${outcome} propagé et jamais SYNCED`,async()=>{
 const c=new CloudSyncRuntimeController({isOnline:()=>true,bootstrap:async()=>({state:'SUCCESS',resumable:false}),push:async()=>{if(outcome==='THROW')throw new Error('NETWORK');return {state:outcome};}});
 c.setUser('A');await c.whenIdle();const f=fixture();f.input.runtime=()=>c.inspect();const v=await inspectCloudSyncVerdict(f.input);assert.notEqual(v.state,'SYNCED');assert.equal(c.inspect().lastPushState,outcome==='THROW'?'STOPPED_ERROR':outcome);if(outcome!=='PENDING')assert.ok(c.inspect().lastError);
});
for(const bootstrap of ['BLOCKED','PARTIAL'])test(`bootstrap ${bootstrap}`,async()=>assert.equal(await state({lastBootstrapState:bootstrap}),'UNVERIFIABLE'));
test('B5 : B reste après ack de A, même avec snapshot réservé',async()=>assert.equal(await state({}, {mutations:[mutation({attempts:1,payloadSnapshot:{value:'B'}})]}),'PENDING'));
test('C2 : intention seule après enqueue échoué',async()=>assert.equal(await state({}, {intents:1}),'PENDING'));
test('C2 : DELETE/tombstone durable après redémarrage',async()=>{const stored=JSON.parse(JSON.stringify({id:'f',__balloonDeleted:true,__balloonPendingSync:[{mutationId:'d',entityType:'flight',entityId:'f',operation:'DELETE'}]}));assert.equal(await state({}, {intents:countStoredSyncIntents(stored)}),'PENDING');});
test('retry futur outbox reste pending',async()=>assert.equal(await state({}, {mutations:[mutation({nextAttemptAt:'2099-01-01'})]}),'PENDING'));
for(const entityType of ['pilot-profile','unit-preferences','weather-preferences','aviation-preferences','pilot-qualifications','balloon-preferences','favorite-launch-site','favorite-weather-place','balloon','flight','logbook-entry','balloon-document'])test(`conflit ${entityType}`,async()=>assert.equal(await state({}, {issues:[{kind:'CONFLICT',entityType,entityId:'x'}]}),'CONFLICT'));
test('NOT_FOUND bloque le verdict',async()=>assert.equal(await state({}, {issues:[{kind:'NOT_FOUND',entityType:'flight',entityId:'f'}]}),'ERROR'));
test('trace pending',async()=>assert.equal(await state({}, {tracks:[{status:'PENDING'}]}),'PENDING'));
test('trace retry/backoff',async()=>assert.equal(await state({}, {tracks:[{status:'FAILED',nextEligibleRetryAt:'2099-01-01'}]}),'ERROR'));
test('découverte trace impossible',async()=>assert.equal(await state({}, {traceDiscoveryComplete:false}),'UNVERIFIABLE'));
for(const type of ['flight-completion','unknown'])test(`type non transporté ${type}`,async()=>assert.equal(await state({}, {mutations:[mutation({entityType:type})]}),'UNVERIFIABLE'));
test('lecture impossible ou JSON invalide',async()=>{const f=fixture();f.input.read=async()=>JSON.parse('{');assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');assert.throws(()=>countStoredSyncIntents({__balloonPendingSync:{}}));});
test('A→B pendant inspection',async()=>{const f=fixture();f.input.read=async()=>{f.changeScope('USER:B');return evidence();};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});
test('A→B→A : génération invalide aussi',async()=>{const f=fixture();f.input.read=async()=>{f.changeScope('USER:B');f.changeGeneration();f.changeScope('USER:A');return evidence();};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});
test('modification après succès révoque ancien passage',async()=>{const f=fixture();assert.equal((await inspectCloudSyncVerdict(f.input)).state,'SYNCED');f.changeGeneration();assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});
test('modification pendant lecture',async()=>{const f=fixture();f.input.read=async()=>{f.changeGeneration();return evidence();};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});
test('SYNCED seulement stable, complet, passage réussi',async()=>{assert.equal(await state(),'SYNCED');assert.equal(await state({}, {coverageComplete:false}),'UNVERIFIABLE');assert.equal(await state({lastPushState:null}),'UNVERIFIABLE');});
test('hors ligne pending / absence de pending non vérifiable',async()=>{const f=fixture({}, {intents:1});f.offline();assert.equal((await inspectCloudSyncVerdict(f.input)).state,'OFFLINE_PENDING');const clean=fixture();clean.offline();assert.equal((await inspectCloudSyncVerdict(clean.input)).state,'UNVERIFIABLE');});
test('activité réelle et utilisateur local',async()=>{assert.equal(await state({pushInProgress:true}),'SYNCING');assert.equal(await state({}, {traceActive:true}),'SYNCING');const f=fixture();f.changeScope('GUEST');assert.equal((await inspectCloudSyncVerdict(f.input)).state,'LOCAL_ONLY');});
test('lecteur base absente ne crée ni ouvre de DB',async()=>{assert.deepEqual(await readExistingSyncStore({open:()=>assert.fail('open')},[],'absent','store'),[]);});
test('invalidation identité A→B→A et modification',()=>{const before=cloudSyncVerdictGeneration();const user=id=>({state:'SIGNED_IN',user:{id}});setRuntimeAuthSnapshot(user('A'));setRuntimeAuthSnapshot(user('B'));setRuntimeAuthSnapshot(user('A'));invalidateCloudSyncVerdict(false);assert.ok(cloudSyncVerdictGeneration()>=before+3);setRuntimeAuthSnapshot({state:'UNKNOWN',user:null});});

test('le runtime change pendant les lectures : résultat invalidé',async()=>{const f=fixture();let busy=false;f.input.runtime=()=>runtime({pushInProgress:busy});f.input.read=async()=>{busy=true;return evidence();};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});

test('lecteur existant utilise seulement readonly et ferme la base',async()=>{
 let closes=0,transactions=0;
 const db={transaction(store,mode){assert.equal(store,'store');assert.equal(mode,'readonly');transactions++;const tx={objectStore(){return {openCursor(){const req={};queueMicrotask(()=>{req.result={value:{id:'f',__balloonDeleted:true,__balloonPendingSync:[{mutationId:'d',entityType:'flight',entityId:'f',operation:'DELETE'}]},continue(){queueMicrotask(()=>{req.result=null;req.onsuccess();tx.oncomplete();});}};req.onsuccess();});return req;}};}};return tx;},close(){closes++;}};
 const factory={open(name){assert.equal(name,'existing');const req={};queueMicrotask(()=>{req.result=db;req.onsuccess();});return req;}};
 const rows=await readExistingSyncStore(factory,[{name:'existing'}],'existing','store');assert.equal(countStoredSyncIntents(rows[0]),1);assert.equal(rows[0].__balloonDeleted,true);assert.equal(transactions,1);assert.equal(closes,1);
});

test('base disparue entre enumeration et open : upgrade aborté, jamais créée',async()=>{
 let aborted=false;
 const factory={open(){const req={transaction:{abort(){aborted=true;}}};queueMicrotask(()=>req.onupgradeneeded());return req;}};
 await assert.rejects(readExistingSyncStore(factory,[{name:'gone'}],'gone','store'),/DATABASE_CHANGED/);assert.equal(aborted,true);
});

function browserFixture(t,values=new Map(),stores=new Map()) {
 const previous=Object.fromEntries(['window','indexedDB'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem(){assert.fail('inspection must not write');},removeItem(){assert.fail('inspection must not delete');}};
 const factory={databases:async()=>[...stores.keys()].map(name=>({name})),open(name){const req={};queueMicrotask(()=>{req.result={transaction(store,mode){assert.equal(mode,'readonly');const rows=stores.get(name).get(store);assert.ok(rows,'expected store');const tx={objectStore(){return {openCursor(){let i=0;const cursorReq={};const advance=()=>{cursorReq.result=i<rows.length?{value:rows[i++],continue:()=>queueMicrotask(advance)}:null;cursorReq.onsuccess();if(!cursorReq.result)tx.oncomplete();};queueMicrotask(advance);return cursorReq;}};}};return tx;},close(){}};req.onsuccess();});return req;}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:storage}});Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:factory});
 t.after(()=>{for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});return {values,storage,factory};
}
const storedKey=legacy=>`balloon-companion-user-data-v1:A:${legacy}`;
test('inspection browser lit intention localStorage après enqueue échoué, sans replay',async(t)=>{
 const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');
 browserFixture(t,new Map([[storedKey('balloon-companion-pilot-profile'),JSON.stringify({firstName:'A',__balloonPendingSync:[{mutationId:'m',entityType:'pilot-profile',entityId:'singleton',operation:'UPSERT'}]})]]));
 const e=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false});assert.equal(e.intents,1);assert.equal(e.coverageComplete,false);assert.equal(await state({},e),'PENDING');
});
test('inspection browser conserve visibilité du tombstone IDB après redémarrage',async(t)=>{
 const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');
 const records=[{id:'d',__balloonDeleted:true,__balloonPendingSync:[{mutationId:'del',entityType:'balloon-document',entityId:'d',operation:'DELETE'}]}];
 browserFixture(t,new Map(),new Map([['balloon-companion-documents:user:A',new Map([['documents',records]])]]));
 const e=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false});assert.equal(e.intents,1);assert.equal(await state({},e),'PENDING');assert.equal(records.length,1);
});
test('inspection browser JSON invalide reste une erreur de lecture',async(t)=>{
 const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t,new Map([[storedKey('balloon-companion-cloud-sync-issues-v1'),'{']]));
 await assert.rejects(readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false}),SyntaxError);
});
test('inspection browser lit diagnostics sans filtre CRUD',async(t)=>{
 const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t,new Map([[storedKey('balloon-companion-cloud-sync-issues-v1'),JSON.stringify([{kind:'CONFLICT',entityType:'pilot-profile',entityId:'singleton'},{kind:'NOT_FOUND',entityType:'flight',entityId:'f'}])]]));
 const e=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false});assert.equal(e.issues.length,2);assert.equal(await state({},e),'CONFLICT');
});
test('inspection browser ne présume pas les traces téléchargées depuis une file vide',async(t)=>{
 const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t,new Map(),new Map([['balloon-companion-flights:user:A',new Map([['flights',[{id:'f',status:'COMPLETED',points:[]}]]])],['balloon-companion-sync-v1:user:A',new Map([['mutations',[]],['metadata',[{entityType:'flight',entityId:'f',revision:1}]]])]]));
 const unknown=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false});assert.equal(unknown.traceDiscoveryComplete,false);assert.equal(await state({},unknown),'UNVERIFIABLE');
 const checked=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false,downloadsChecked:true});assert.equal(checked.traceDiscoveryComplete,true);
});
test('session inconnue ne devient pas utilisateur local connecté/déconnecté supposé',async()=>{const f=fixture();f.changeScope(null);f.input.authKnown=()=>false;assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');});
test('récupération C2 active participe à SYNCING',async()=>assert.equal(await state({}, {recoveryActive:true}),'SYNCING'));
test('session offline : runtime arrêté, mais pending du compte reste observable',async()=>{const f=fixture({scope:null,lastError:null,lastPushState:null}, {intents:1});f.offline();assert.equal((await inspectCloudSyncVerdict(f.input)).state,'OFFLINE_PENDING');});
test('diagnostic runtime A ne contamine pas le compte B',async()=>{assert.equal(await state({scope:'USER:OTHER',lastError:{code:'OLD_ERROR'}},{mutations:[mutation()]}),'PENDING');assert.equal(await state({scope:'USER:OTHER'}),'UNVERIFIABLE');});
test('écriture métier C2 réelle révoque la génération précédemment vérifiée',async()=>{
 const {withSyncIntents}=await import('./durableSyncIntent.ts');const g=cloudSyncVerdictGeneration();
 const f=fixture({}, {passGeneration:g});f.input.getGeneration=cloudSyncVerdictGeneration;
 assert.equal((await inspectCloudSyncVerdict(f.input)).state,'SYNCED');
 const saved=withSyncIntents({id:'f'},[{entityType:'flight',entityId:'f',operation:'UPSERT'}],{},'USER:A');
 assert.equal(countStoredSyncIntents(saved),1);assert.ok(cloudSyncVerdictGeneration()>g);
 assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');
});
test('donnée scoped de couverture inconnue ne compte pas comme synchronisée',async(t)=>{const {readBrowserCloudSyncEvidence}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t,new Map([[storedKey('unknown-business-domain'),JSON.stringify({id:'x'})]]));const e=await readBrowserCloudSyncEvidence('USER:A',runtime(),{complete:true,generation:0,active:false});assert.equal(e.coverageComplete,false);assert.equal(await state({},e),'UNVERIFIABLE');});
test('adapter navigateur : succès vérifié, historique distinct et session offline conservatrice',async(t)=>{
 const {inspectBrowserCloudSyncVerdict,acceptBrowserCloudSyncVerdict}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t);
 const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'A'}});
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator;setRuntimeAuthSnapshot({state:'UNKNOWN',user:null});});
 const g=cloudSyncVerdictGeneration(),trace=()=>({complete:true,generation:g,active:false});
 const synced=await inspectBrowserCloudSyncVerdict(()=>runtime(),trace);assert.equal(synced.state,'SYNCED');assert.ok(acceptBrowserCloudSyncVerdict(synced,()=>runtime(),trace));assert.notEqual(synced.verifiedAt,synced.bootstrapAt);
 invalidateCloudSyncVerdict(false);const changed=await inspectBrowserCloudSyncVerdict(()=>runtime(),trace);assert.equal(changed.state,'UNVERIFIABLE');assert.equal(changed.verifiedAt,synced.verifiedAt);
 setRuntimeAuthSnapshot({state:'OFFLINE_SESSION',user:{id:'A'}});const offline=await inspectBrowserCloudSyncVerdict(()=>runtime(),()=>({complete:true,generation:cloudSyncVerdictGeneration(),active:false}));assert.equal(offline.state,'UNVERIFIABLE');
});

async function observedFixture() {
 const f=fixture({}, {passGeneration:cloudSyncVerdictGeneration()});
 f.input.getGeneration=cloudSyncVerdictGeneration;f.input.getObservationVersion=cloudSyncObservationVersion;
 return f;
}
test('A : NOT_FOUND ajouté après première lecture (repository réel) invalide inspection',async()=>{
 const {BrowserCloudSyncIssueRepository}=await import('./cloudSyncBrowser.ts');const values=new Map();
 const repo=new BrowserCloudSyncIssueRepository({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},'USER:A');
 const f=await observedFixture();f.input.read=async()=>{const issues=await repo.list();await repo.save({kind:'NOT_FOUND',entityType:'flight',entityId:'f'});return evidence({issues,passGeneration:cloudSyncVerdictGeneration()});};
 assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');assert.equal((await repo.list()).length,1);
});
test('B : drain démarre pendant awaits, ancienne activité inactive rejetée',async()=>{
 const {drainFlightTrackQueue,isFlightTrackQueueRunning}=await import('./flightTrackQueue.ts');
 const f=await observedFixture();let release,drain;const gate=new Promise(resolve=>release=resolve);
 f.input.read=async()=>{const e=evidence({passGeneration:cloudSyncVerdictGeneration()});drain=drainFlightTrackQueue({scope:'USER:A',getScope:()=> 'USER:A',online:()=>true,storage:{list:async()=>{await gate;return [];}},transport:{}});return e;};
 try {assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');assert.equal(isFlightTrackQueueRunning('USER:A'),true);} finally {release();await drain;}
});
test('C : drain commence et finit pendant inspection, version détecte inactive→active→inactive',async()=>{
 const {drainFlightTrackQueue}=await import('./flightTrackQueue.ts');const f=await observedFixture();
 f.input.read=async()=>{await drainFlightTrackQueue({scope:'USER:A',getScope:()=> 'USER:A',online:()=>true,storage:{list:async()=>[]},transport:{}});return evidence({passGeneration:cloudSyncVerdictGeneration()});};
 assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');
});
const acceptanceContext=(v,extra={})=>({applicable:true,scope:v.scope,generation:v.generation,observation:v.validation.observation,runtime:v.validation.runtime,activity:v.validation.activity,online:true,...extra});
test('D/E : seulement un SYNCED accepté avance la date ; abandonné/invalide aucun effet',async()=>{
 const store=new CloudSyncVerdictAcceptance(),first=await inspectCloudSyncVerdict(fixture().input);
 assert.equal(store.lastVerifiedAt('USER:A'),null);assert.ok(store.accept(first,acceptanceContext(first)));assert.equal(store.lastVerifiedAt('USER:A'),first.verifiedAt);
 const newer=await inspectCloudSyncVerdict(fixture({lastPushCompletedAt:'2026-09-17T13:00:00Z'}).input);
 for(const extra of [{applicable:false},{generation:newer.generation+1},{observation:newer.validation.observation+1},{runtime:'changed'},{activity:'changed'},{scope:'USER:B'}]) {assert.equal(store.accept(newer,acceptanceContext(newer,extra)),null);assert.equal(store.lastVerifiedAt('USER:A'),first.verifiedAt);assert.equal(store.lastVerifiedAt('USER:B'),null);}
 assert.ok(store.accept(newer,acceptanceContext(newer)));assert.equal(store.lastVerifiedAt('USER:A'),newer.verifiedAt);
});
test('F : découverte échouée + job existant reste drainé, erreur observable',async()=>{
 const {discoverAndDrainFlightTracks,drainFlightTrackQueue,MemoryFlightTrackQueueStorage}=await import('./flightTrackQueue.ts');
 const queue=new MemoryFlightTrackQueueStorage();await queue.put({jobId:'j',scope:'USER:A',userId:'A',flightId:'f',operation:'UPLOAD',generation:1,attempts:0,status:'PENDING',createdAt:'2026-09-17'});let uploads=0;
 const r=await discoverAndDrainFlightTracks({discover:async()=>{throw new Error('NETWORK');},drain:()=>drainFlightTrackQueue({scope:'USER:A',getScope:()=> 'USER:A',online:()=>true,storage:queue,transport:{upload:async()=>uploads++}})});
 assert.equal(uploads,1);assert.equal((await queue.list()).length,0);assert.equal(r.discoveryComplete,false);assert.equal(r.discoveryError,'TRACE_DISCOVERY_FAILED');assert.equal(await state({}, {traceDiscoveryComplete:r.discoveryComplete}),'UNVERIFIABLE');
});
for(const race of ['diagnostic','trace'])test(`G : A→B pendant race ${race}, aucun verdict/date A dans B`,async()=>{
 const f=await observedFixture();
 f.input.read=async()=>{
   const before=evidence({passGeneration:cloudSyncVerdictGeneration()});
   if(race==='diagnostic') {
     const {BrowserCloudSyncIssueRepository}=await import('./cloudSyncBrowser.ts');const values=new Map();
     const repo=new BrowserCloudSyncIssueRepository({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},'USER:A');
     await repo.save({kind:'NOT_FOUND',entityType:'flight',entityId:'f'});f.changeScope('USER:B');
   } else {
     const {drainFlightTrackQueue}=await import('./flightTrackQueue.ts');
     await drainFlightTrackQueue({scope:'USER:A',getScope:f.input.getScope,online:()=>true,storage:{list:async()=>{f.changeScope('USER:B');return [];}},transport:{}});
   }
   return before;
 };
 const v=await inspectCloudSyncVerdict(f.input);assert.equal(v.state,'UNVERIFIABLE');const store=new CloudSyncVerdictAcceptance();assert.equal(store.accept(v,acceptanceContext(v,{scope:'USER:B'})),null);assert.equal(store.lastVerifiedAt('USER:B'),null);
});
test('double lecture finale détecte diagnostic/file trace sans notification',async()=>{
 for(const last of [{issues:[{kind:'NOT_FOUND'}]},{tracks:[{status:'PENDING'}]},{traceActive:true}]){const f=fixture();let reads=0;f.input.read=async()=>evidence(reads++?last:{});assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');assert.equal(reads,2);}
});
test('adapter inspection pure : un candidat SYNCED abandonné ne remplit pas la date',async(t)=>{
 const {inspectBrowserCloudSyncVerdict,acceptBrowserCloudSyncVerdict}=await import('./cloudSyncVerdictBrowser.ts');browserFixture(t);
 const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'A'}});t.after(()=>{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator;setRuntimeAuthSnapshot({state:'UNKNOWN',user:null});});
 const g=cloudSyncVerdictGeneration(),trace=()=>({complete:true,generation:g,active:false}),r=()=>runtime({lastPushCompletedAt:'2026-09-17T18:00:00Z'});
 const candidate=await inspectBrowserCloudSyncVerdict(r,trace);assert.equal(candidate.state,'SYNCED');
 assert.equal(acceptBrowserCloudSyncVerdict(candidate,r,trace,false),null);
 invalidateCloudSyncVerdict(false);assert.equal(acceptBrowserCloudSyncVerdict(candidate,r,trace),null);const invalid=await inspectBrowserCloudSyncVerdict(r,trace);assert.notEqual(invalid.verifiedAt,candidate.verifiedAt);
});
test('diagnostic modifié/supprimé pendant inspection : observation invalide aussi',async()=>{
 const {BrowserCloudSyncIssueRepository}=await import('./cloudSyncBrowser.ts');const values=new Map(),repo=new BrowserCloudSyncIssueRepository({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},'USER:A');
 const f=await observedFixture();f.input.read=async()=>{await repo.save({kind:'NOT_FOUND',entityType:'flight',entityId:'f'});await repo.remove('flight','f');return evidence({passGeneration:cloudSyncVerdictGeneration()});};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');assert.equal((await repo.list()).length,0);
});
test('version runtime détecte bootstrap démarré/terminé pendant inspection',async()=>{
 const {invalidateCloudSyncObservation}=await import('./cloudSyncVerdict.ts');const f=await observedFixture();f.input.read=async()=>{invalidateCloudSyncObservation();invalidateCloudSyncObservation();return evidence({passGeneration:cloudSyncVerdictGeneration()});};assert.equal((await inspectCloudSyncVerdict(f.input)).state,'UNVERIFIABLE');
});
