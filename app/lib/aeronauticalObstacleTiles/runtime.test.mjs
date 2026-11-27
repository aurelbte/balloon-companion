import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {datasets,server,box,deferred} from './runtime.fixtures.mjs';
import {AeronauticalObstacleTileRuntime} from './runtime.ts';
import {parseObstacleManifest,parseObstacleTile,canonical,sha256} from './contract.ts';
import {selectObstacleTiles} from './viewport.ts';
let data;
before(async()=>{data=await datasets();});after(async()=>{if(data)await rm(data.root,{recursive:true,force:true});});
const instances=new Set();afterEach(()=>{for(const r of instances)r.dispose();instances.clear();});
const runtime=(d,extra={})=>{const s=server(d),r=new AeronauticalObstacleTileRuntime({baseUrl:'https://local.invalid/dataset/',fetchImpl:s.fetch,...extra});instances.add(r);return{s,r};};
const flush=()=>new Promise(r=>setImmediate(r));
const until=async predicate=>{const deadline=Date.now()+2000;while(!predicate()){if(Date.now()>deadline)throw Error('Expected async state was not reached');await flush();}};
const repack=v=>new TextEncoder().encode(JSON.stringify(v));

test('2A manifests, identities, every SHA-256 and all tiles validate for both real subsets and synthetic Preuseville',async()=>{
 for(const zone of ['preuseville','le-havre','grenoble']) {
  const d=data[zone],manifest=await parseObstacleManifest(d.manifestBytes,createHash('sha256').update(d.manifestBytes).digest('hex'));
  const members=new Map([[9,new Set()],[12,new Set()]]);
  for(const e of manifest.tiling.tiles) {
   const tile=await parseObstacleTile(d.files.get(e.key),e,manifest);
   for(const f of tile.features)for(const id of f.properties.memberObservationIds)members.get(e.z).add(id);
   if(e.status==='empty')assert.equal(tile.features.length,0);
  }
  assert.equal(members.get(9).size,d.records.length);assert.equal(members.get(12).size,d.records.length);
 }
});

test('real Le Havre retains 13 unknown-height cranes; Grenoble retains distinct cable fragments and all original provenance/vertical measures',async()=>{
 for(const zone of ['le-havre','grenoble']) {
  const d=data[zone],{r}=runtime(d);const view=r.createView();
  const result=await view.update({west:d.centre[0]-.8,east:d.centre[0]+.8,south:d.centre[1]-.8,north:d.centre[1]+.8},13);
  const rows=new Map(result.snapshot.features.flatMap(f=>f.properties.observations.map(o=>[o.observationId,o])));
  for(const record of d.records) {assert.deepEqual(rows.get(record.observationId).measurements,record.measurements);assert.deepEqual(rows.get(record.observationId).sourceEditionIds,record.sourceEditionIds);}
  if(zone==='le-havre') {const cranes=[...rows.values()].filter(r=>r.category==='crane');assert.equal(cranes.length,13);assert.ok(cranes.every(r=>r.measurements.heightAgl.valueM===null&&r.permanence==='unknown'));}
  else {const lines=result.snapshot.features.filter(f=>f.properties.fragmentOf);assert.ok(lines.length>1);assert.equal(new Set(lines.map(f=>f.id)).size,lines.length);assert.ok(lines.every(f=>f.properties.observations.every(o=>o.verticalProfile==='unknown')));assert.ok(result.snapshot.features.some(f=>f.geometry.type==='Point'&&f.properties.category==='aerial_cable'));}
  assert.equal(result.snapshot.exhaustive,false);assert.equal(result.snapshot.physicalObjectCount,null);r.dispose();
 }
});

test('z9 through display zoom 10, z12 from 11 with overzoom; tile edges, antimeridian and global views stay bounded',async()=>{
 const d=data['le-havre'],m=await parseObstacleManifest(d.manifestBytes),tile=m.tiling.tiles.find(t=>t.z===12);
 assert.equal(selectObstacleTiles(m,box(tile),10.9).zoom,9);assert.equal(selectObstacleTiles(m,box(tile),11).zoom,12);
 assert.equal(selectObstacleTiles(m,box(tile),24).tiles.length,1);assert.equal(selectObstacleTiles(m,box(tile),12).outsideTileCount,0);
 const world=selectObstacleTiles(m,{west:-180,east:180,south:-85,north:85},12);assert.equal(world.tiles.length,m.tiling.tiles.filter(t=>t.z===12).length);assert.ok(world.outsideTileCount>1e6);
 const crossed=selectObstacleTiles(m,{west:170,east:-170,south:40,north:50},12);assert.equal(crossed.tiles.length,0);
 assert.equal(selectObstacleTiles(m,{west:179.999,east:539.998,south:-85,north:85},9).outsideTileCount,selectObstacleTiles(m,{west:-180,east:180,south:-85,north:85},9).outsideTileCount);
 assert.throws(()=>selectObstacleTiles(m,{west:0,east:1,south:2,north:1},12),/INVALID_VIEWPORT/);
});

test('outside coverage, explicit empty, loading and budget-limited NOT_LOADED remain distinct; never a safety zero',async()=>{
 const d=data['preuseville'],{r,s}=runtime(d,{maxTilesPerView:1}),v=r.createView();await r.readManifest();
 const empty=d.manifest.tiling.tiles.find(e=>e.z===12&&!e.features);
 const loaded=await v.update(box(empty),12);assert.equal(loaded.snapshot.tiles[0].status,'EMPTY');assert.equal(loaded.snapshot.loadedObservationCount,0);assert.match(loaded.snapshot.safetyWarning,/ne garantit jamais/);
 const outside=await v.update({west:80,east:81,south:0,north:1},12);assert.equal(outside.snapshot.coverage,'OUTSIDE_COVERAGE');assert.equal(outside.snapshot.completeForIndexedSelection,false);
 const gate=deferred();s.setHandler(p=>p==='manifest.json'?undefined:gate.promise);
 const pending=v.update({west:1,east:2,south:49,north:50},9);await flush();assert.ok(v.snapshot.tiles.some(t=>t.status==='LOADING'));
 r.dispose();await pending;gate.resolve(new Response('{}'));
 const many=runtime(data['le-havre'],{maxTilesPerView:1}),w=many.r.createView();
 const result=await w.update({west:-.5,east:.8,south:49,north:50},12);assert.ok(result.snapshot.tiles.some(t=>t.status==='NOT_LOADED'&&t.reason==='VIEW_TILE_BUDGET_EXCEEDED'));assert.equal(result.snapshot.completeForIndexedSelection,false);many.r.dispose();
});

test('manifest schema, policy, identity, unsafe paths, metadata counts and externally pinned digest are enforced',async()=>{
 const d=data['preuseville'];await assert.rejects(parseObstacleManifest(d.manifestBytes,'0'.repeat(64)),{code:'HASH_MISMATCH'});
 for(const mutate of [m=>m.schemaVersion=2,m=>m.tiling.policy.detailZoom=11,m=>m.sources[0]=null,m=>m.artifacts['../escape']={bytes:1,sha256:'0'.repeat(64),contentType:'application/json'},m=>m.tiling.tiles[0].bbox[0]++,m=>m.tiling.tiles.push(m.tiling.tiles[0]),m=>m.tiling.tiles[0].status='empty',m=>m.statistics.tileBytes++]) {
  const m=structuredClone(d.manifest);mutate(m);await assert.rejects(parseObstacleManifest(repack(m)),e=>['INVALID_MANIFEST','HASH_MISMATCH'].includes(e.code));
 }
 const bad=structuredClone(d.manifest);bad.identity.normalizedVersion='0'.repeat(64);await assert.rejects(parseObstacleManifest(repack(bad)),{code:'HASH_MISMATCH'});
});

for(const [name,status]of [['HTTP_404',404],['HTTP_410',410],['HTTP_ERROR',503]])test(`${name} is not cached or interpreted as an empty tile; retry succeeds`,async()=>{
 const d=data['preuseville'],e=d.manifest.tiling.tiles.find(t=>t.z===12&&t.features),{r,s}=runtime(d),v=r.createView();let fails=true;
 s.setHandler(p=>p===e.key&&fails?new Response('',{status}):undefined);
 const failed=await v.update(box(e),12);assert.equal(failed.snapshot.tiles[0].status,name);assert.equal(failed.snapshot.tiles[0].httpStatus,status);assert.equal(failed.snapshot.completeForIndexedSelection,false);
 fails=false;assert.equal((await v.update(box(e),12)).snapshot.tiles[0].status,'LOADED');r.dispose();
});

test('network, timeout, malformed GeoJSON and bad fingerprints are independent errors',async()=>{
 const d=data['preuseville'],e=d.manifest.tiling.tiles.find(t=>t.z===12&&t.features);
 for(const [expected,handler]of [['NETWORK_ERROR',()=>{throw Error('offline');}],['TIMEOUT',()=>new Promise(()=>{})],['HASH_MISMATCH',()=>new Response(Buffer.from(d.files.get(e.key)).fill(32))]]) {
  const {r,s}=runtime(d,{timeoutMs:25});s.setHandler(p=>p===e.key?handler():undefined);const out=await r.createView().update(box(e),12);assert.equal(out.snapshot.tiles[0].status,expected);assert.equal(out.snapshot.tiles[0].data,undefined);r.dispose();
 }
 const bytes=repack({type:'not-GeoJSON',features:[]}),entry={...e,bytes:bytes.length,sha256:await sha256(bytes)};
 await assert.rejects(parseObstacleTile(bytes,entry,d.manifest),{code:'INVALID_GEOJSON'});
 const tile=JSON.parse(d.files.get(e.key));tile.features[0].properties.observations[0].measurements.heightAgl.datum=5;
 const invalid=repack(tile);await assert.rejects(parseObstacleTile(invalid,{...e,bytes:invalid.length,sha256:await sha256(invalid)},d.manifest),{code:'INVALID_GEOJSON'});
});

test('two views share one manifest/tile fetch; closing one never aborts the remaining consumer; memory LRU is bounded',async()=>{
 const d=data['le-havre'],e=d.manifest.tiling.tiles.find(t=>t.z===12&&t.features),{r,s}=runtime(d,{maxCacheEntries:2,maxCacheBytes:4000000}),gate=deferred();
 s.setHandler(p=>p===e.key?gate.promise:undefined);const a=r.createView(),b=r.createView();const first=a.update(box(e),12),second=b.update(box(e),12);await until(()=>s.calls.some(c=>c.path===e.key));
 assert.equal(s.calls.filter(c=>c.path==='manifest.json').length,1);assert.equal(s.calls.filter(c=>c.path===e.key).length,1);a.close();assert.equal(s.calls.find(c=>c.path===e.key).signal.aborted,false);
 gate.resolve(new Response(d.files.get(e.key)));assert.equal((await second).snapshot.tiles[0].status,'LOADED');assert.equal((await first).obsolete,true);
 s.setHandler(()=>undefined);const before=s.calls.length;await b.update(box(e),12);assert.equal(s.calls.length,before);
 for(const entry of d.manifest.tiling.tiles.filter(t=>t.z===12).slice(0,5))await b.update(box(entry),12);
 assert.ok(r.stats.cacheEntries<=2);assert.ok(r.stats.cacheBytes<=4000000);r.dispose();assert.equal(r.stats.pending,0);
});

test('rapid viewport/LOD changes cancel unused requests, settle old callers and never cache or publish late obsolete responses',async()=>{
 const d=data['le-havre'],entries=d.manifest.tiling.tiles.filter(t=>t.z===12&&t.features),a=entries[0],b=entries.find(t=>t.key!==a.key),{r,s}=runtime(d),gate=deferred(),published=[];
 s.setHandler(p=>p===a.key?gate.promise:undefined);const v=r.createView(snapshot=>published.push(snapshot));const first=v.update(box(a),12);await until(()=>s.calls.some(c=>c.path===a.key));
 const second=await v.update(box(b),12);assert.equal(second.obsolete,false);assert.equal(second.snapshot.tiles[0].key,b.key);assert.equal((await first).obsolete,true);assert.equal(s.calls.find(c=>c.path===a.key).signal.aborted,true);
 const cacheCount=r.stats.cacheEntries;gate.resolve(new Response(d.files.get(a.key)));await flush();await flush();assert.equal(r.stats.cacheEntries,cacheCount);assert.equal(v.snapshot.tiles[0].key,b.key);
 assert.ok(published.filter(p=>p.generation===2).every(p=>p.tiles.every(t=>t.key!==a.key)));
 const low=await v.update(box(b),9);assert.equal(low.snapshot.sourceZoom,9);assert.ok(low.snapshot.tiles.every(t=>t.key.startsWith('tiles/9/')));r.dispose();
});

test('concurrency cap and cancellation also cover queued requests, without unhandled rejections',async()=>{
 const d=data['le-havre'],{r,s}=runtime(d,{concurrency:2}),gates=[];
 s.setHandler(p=>{if(p==='manifest.json')return;const gate=deferred();gates.push(gate);return gate.promise;});
 const v=r.createView(),pending=v.update({west:-.5,east:.8,south:49,north:50},12);await until(()=>gates.length===2);assert.equal(r.stats.active,2);assert.equal(gates.length,2);assert.ok(r.stats.pending>2);
 await v.update({west:80,east:81,south:0,north:1},12);assert.equal((await pending).obsolete,true);assert.equal(r.stats.pending,0);assert.equal(r.stats.active,0);
 gates.forEach(g=>g.resolve(new Response('{}')));await flush();r.dispose();
});

test('browser-only emitted dependency graph executes without Node globals; unavailable WebCrypto fails closed',async()=>{
 const ts=await import('typescript'),vm=await import('node:vm'),path=await import('node:path');
 const context=vm.createContext({URL,AbortController,TextDecoder,TextEncoder,Uint8Array,setTimeout,clearTimeout,crypto:globalThis.crypto});
 const modules=new Map(),visited=[];
 const load=async file=>{
  if(modules.has(file))return modules.get(file);
  const source=await readFile(file,'utf8');
  const esm=ts.default.transpileModule(source,{compilerOptions:{target:ts.default.ScriptTarget.ES2017,module:ts.default.ModuleKind.ESNext}}).outputText;
  assert.doesNotMatch(esm,/node:|\bBuffer\b|\bprocess\b|AbortSignal\.(timeout|any)|Promise\.withResolvers|\.at\(/);
  const imports=[...esm.matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1]);
  const dependencies={};for(const name of imports){assert.ok(name.startsWith('.'),name);dependencies[name]=await load(path.resolve(path.dirname(file),name));}
  const compiled=ts.default.transpileModule(source,{compilerOptions:{target:ts.default.ScriptTarget.ES2017,module:ts.default.ModuleKind.CommonJS}}).outputText;
  const exports={};const fn=vm.runInContext(`(function(require,exports){${compiled}\n})`,context);fn(name=>{assert.ok(name in dependencies,name);return dependencies[name];},exports);
  modules.set(file,exports);visited.push(file);return exports;
 };
 const root=path.resolve('app/lib/aeronauticalObstacleTiles/index.ts'),browser=await load(root),d=data['preuseville'],s=server(d);
 assert.equal(visited.length,5);assert.ok(visited.some(p=>p.endsWith('tileGeometry.ts')));
 const r=new browser.AeronauticalObstacleTileRuntime({baseUrl:'https://local.invalid/dataset/',fetchImpl:s.fetch});
 assert.equal((await r.readManifest()).version,d.manifest.version);r.dispose();
 context.crypto=undefined;
 const unavailable=new browser.AeronauticalObstacleTileRuntime({baseUrl:'https://local.invalid/dataset/',fetchImpl:s.fetch});
 await assert.rejects(unavailable.readManifest(),{code:'CRYPTO_UNAVAILABLE'});unavailable.dispose();
});

test('oversized responses and manifest errors remain explicit; external manifest cancellation preserves another reader',async()=>{
 const d=data['preuseville'],s=server(d),gate=deferred();s.setHandler(p=>p==='manifest.json'?gate.promise:undefined);
 const r=new AeronauticalObstacleTileRuntime({baseUrl:'https://local.invalid/dataset/',fetchImpl:s.fetch});const a=new AbortController(),b=new AbortController();
 const pa=r.readManifest(a.signal),pb=r.readManifest(b.signal);a.abort();await assert.rejects(pa,{code:'CANCELLED'});
 assert.equal(s.calls[0]?.signal.aborted??false,false);gate.resolve(new Response(d.manifestBytes));assert.equal((await pb).version,d.manifest.version);r.dispose();
 const e=d.manifest.tiling.tiles.find(e=>e.z===12&&e.features),large=runtime(d);large.s.setHandler(p=>p===e.key?new Response(new Uint8Array(8*1024*1024+1)):undefined);
 assert.equal((await large.r.createView().update(box(e),12)).snapshot.tiles[0].status,'BODY_TOO_LARGE');large.r.dispose();
 const invalid=runtime(d);invalid.s.setHandler(p=>p==='manifest.json'?new Response('{'):undefined);
 const out=await invalid.r.createView().update(box(e),12);assert.equal(out.snapshot.manifestError,'INVALID_MANIFEST');assert.equal(out.snapshot.coverage,'UNKNOWN');assert.equal(out.snapshot.completeForIndexedSelection,false);invalid.r.dispose();
});

test('HTTP compression uses decoded SHA/bytes, not compressed Content-Length; immutable cache cannot be modified by consumers',async()=>{
 const d=data['preuseville'],e=d.manifest.tiling.tiles.find(t=>t.z===12&&t.features),{r,s}=runtime(d);
 // Browser Fetch has already decoded gzip: Content-Length can still be its compressed length.
 s.setHandler(p=>p===e.key?new Response(d.files.get(e.key),{headers:{'content-encoding':'gzip','content-length':String(e.bytes+100)}}):undefined);
 const result=await r.createView().update(box(e),12);assert.equal(result.snapshot.tiles[0].status,'LOADED');
 assert.throws(()=>{result.snapshot.features[0].properties.observations[0].measurements.heightAgl.valueM=1000;},TypeError);r.dispose();
});

test('candidate observations stay separate; explicit confirmed identities are read without further fusion',async()=>{
 const {normalizeSia}=await import('../../../prototypes/aeronautical-obstacles/normalize.ts');const {makeTiles}=await import('../../../prototypes/aeronautical-obstacles/tiles.ts');
 const d=data.preuseville,a=d.records[0],b=normalizeSia({...a.original,IDENTIFICATEUR:'synthetic-second'},['retained-SIA']);
 for(const decision of ['candidate','ambiguous','confirmed']) {
  const link={id:'synthetic-reviewed-link',fromObservationId:a.observationId,toObservationId:b.observationId,relation:'possible_same_object',decision,method:'explicit synthetic test',evidence:['test only'],alternatives:[],distanceM:0,distanceMethod:'point_haversine',heightComparison:null};
  const generated=makeTiles([a,b],[link],d.centre,1000).tiles.find(t=>t.z===12&&t.features.length),original=d.manifest.tiling.tiles.find(t=>t.key===generated.key),bytes=repack({type:'FeatureCollection',features:generated.features});
  const entry={...original,bytes:bytes.length,sha256:await sha256(bytes),features:generated.features.length,classes:{points:generated.features.length},categories:{mast_antenna:generated.features.length}};
  const tile=await parseObstacleTile(bytes,entry,d.manifest);assert.equal(tile.features.length,decision==='confirmed'?1:2);assert.equal(new Set(tile.features.flatMap(f=>f.properties.memberObservationIds)).size,2);
 }
});

test('contradictory same-observation metadata across individually hash-valid fragments is retained for diagnosis, never silently selected',async()=>{
 const {gzipSync}=await import('node:zlib');const d=data.grenoble,m=structuredClone(d.manifest),files=new Map(d.files),candidates=m.tiling.tiles.filter(t=>t.z===12&&t.features);
 const byObservation=new Map();let pair;
 for(const e of candidates){for(const f of JSON.parse(files.get(e.key)).features.filter(f=>f.properties.fragmentOf)){
  const id=f.properties.memberObservationIds[0];if(byObservation.has(id)&&byObservation.get(id).entry.key!==e.key){pair=[byObservation.get(id),{entry:e,feature:f}];break;}byObservation.set(id,{entry:e,feature:f});
 }if(pair)break;}
 assert.ok(pair);const changed=pair[1],collection=JSON.parse(files.get(changed.entry.key)),feature=collection.features.find(f=>f.id===changed.feature.id),o=feature.properties.observations[0];
 o.measurements.heightAgl={...o.measurements.heightAgl,originalValue:100,originalUnit:'m',unit:'m',valueM:100,unknownReason:null};feature.properties.unknownAglCount=feature.properties.observations.filter(o=>o.measurements.heightAgl.valueM===null).length;
 const bytes=repack(collection),compressed=gzipSync(bytes);compressed[9]=255;const h=await sha256(bytes),gz=await sha256(compressed);
 Object.assign(changed.entry,{bytes:bytes.length,sha256:h,gzipBytes:compressed.length,gzipSha256:gz});Object.assign(m.artifacts[changed.entry.key],{bytes:bytes.length,sha256:h});Object.assign(m.artifacts[changed.entry.key+'.gz'],{bytes:compressed.length,sha256:gz,decodedSha256:h});
 m.statistics.payloadBytes=Object.values(m.artifacts).reduce((n,a)=>n+a.bytes,0);m.statistics.tileBytes=m.tiling.tiles.reduce((n,t)=>n+t.bytes,0);m.statistics.tileGzipBytes=m.tiling.tiles.reduce((n,t)=>n+t.gzipBytes,0);
 files.set(changed.entry.key,bytes);files.set('manifest.json',repack(m));const {r}=runtime({...d,files});
 const result=await r.createView().update({west:4.8,east:6.5,south:44.8,north:45.7},12);
 assert.equal(result.snapshot.integrityError,'IDENTITY_CONFLICT');assert.ok(result.snapshot.conflicts.includes(o.observationId));assert.ok(result.snapshot.conflictingFeatures.length>=2);
 assert.ok(result.snapshot.features.every(f=>!f.properties.memberObservationIds.includes(o.observationId)));assert.equal(result.snapshot.completeForIndexedSelection,false);r.dispose();
});

test('warm-cache offline reuse succeeds, cold-cache offline data stays unknown rather than zero obstacles',async()=>{
 const d=data.preuseville,e=d.manifest.tiling.tiles.find(t=>t.z===12&&t.features),{r,s}=runtime(d),view=r.createView();
 await view.update(box(e),12);s.setHandler(()=>{throw Error('offline');});const warm=await view.update(box(e),12);assert.equal(warm.snapshot.tiles[0].status,'LOADED');
 const cold=new AeronauticalObstacleTileRuntime({baseUrl:'https://local.invalid/dataset/',fetchImpl:async()=>{throw Error('offline');}});
 const failed=await cold.createView().update(box(e),12);assert.equal(failed.snapshot.manifestError,'NETWORK_ERROR');assert.equal(failed.snapshot.coverage,'UNKNOWN');assert.equal(failed.snapshot.loadedObservationCount,null);r.dispose();cold.dispose();
});
