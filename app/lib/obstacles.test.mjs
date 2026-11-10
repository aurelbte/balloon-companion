import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObstacles, obstacleHeight, obstacleQueryBounds, buildObstaclesQuery, validateObstacleResult } from './obstacles.ts';
import { getPowerLineQueryBounds, parsePowerLines } from './powerLines.ts';
import { PowerLineMemoryStore, PowerLineRuntime } from './powerLinesRuntime.ts';
const viewport = { west: 3, south: 50.6, east: 3.1, north: 50.7 };
const stamp = '2026-11-04T12:00:00Z';
const way = { type: 'way', id: 1, tags: { power: 'line' }, geometry: [{ lon: 3.01, lat: 50.61 }, { lon: 3.05, lat: 50.65 }] };
const tower = { type: 'node', id: 1, lat: 50.65, lon: 3.05, tags: { power: 'tower', height: '32 m', name: '<script>name</script>' } };
function payload(bounds, obstacleElements = [tower], lineElements = [way]) {
 return { ...parsePowerLines({ elements: lineElements }), bounds, fetchedAt: stamp, obstacles: { ...parseObstacles({ elements: obstacleElements }), bounds: obstacleQueryBounds(bounds), fetchedAt: stamp } };
}
function harness(fetcher) {
 const store = new PowerLineMemoryStore(fetcher); let lines, obstacles;
 const runtime = new PowerLineRuntime(s => { lines = s; }, store, s => { obstacles = s; }, () => Date.parse(stamp) + 60_000);
 return { store, runtime, get lines() { return lines; }, get obstacles() { return obstacles; } };
}
test('OSM typed IDs distinguish nodes/ways/relations and retain height and representative centers', () => {
 const result = parseObstacles({ elements: [tower, { type: 'way', id: 1, center: { lon: 3.06, lat: 50.66 }, tags: { man_made: 'mast', height: '100 ft' } }, { type: 'relation', id: 1, center: { lon: 3.07, lat: 50.67 }, tags: { power: 'generator', 'generator:source': 'wind' } }, way] });
 assert.equal(result.complete, true);
 assert.deepEqual(result.features.map(f => f.id), ['node/1', 'way/1', 'relation/1']);
 assert.deepEqual(result.features.map(f => f.properties.heightM), [32, 30.5, null]);
 assert.deepEqual(result.features.map(f => f.properties.kind), ['pylon', 'mast', 'wind']);
});
test('height parser handles metres/feet and never invents missing or implausible heights', () => {
 for (const [value, expected] of [['12,5 m', 12.5], ['30',30], ["10'",3], ['unknown',null], ['-5',null], ['3000',null], ['12;30',null], [undefined,null]]) assert.equal(obstacleHeight(value),expected);
});
test('remark, missing center, invalid point and density cap are partial, never confirmed empty', () => {
 for (const raw of [{elements:[tower],remark:'timeout'}, {elements:[{...tower,lat:NaN}]}, {elements:[{type:'way',id:2,tags:{man_made:'antenna'}}]}, {elements:Array.from({length:5001},(_,i)=>({...tower,id:i+1}))}]) {
  const result=parseObstacles(raw); assert.equal(result.complete,false); assert.equal(result.emptyConfirmed,false); assert.ok(result.features.length<=5000);
 }
});
test('client rejects wrong bounds, malformed schema, duplicate IDs, bad points and height', () => {
 const bounds=obstacleQueryBounds(getPowerLineQueryBounds(viewport));
 const valid={...parseObstacles({elements:[tower]}),bounds,fetchedAt:stamp};
 assert.equal(validateObstacleResult(valid,bounds),valid);
 for (const bad of [{...valid,bounds:{...bounds,east:9}},{...valid,complete:true,rejectedElements:1},{...valid,features:[valid.features[0],valid.features[0]]},{...valid,features:[{...valid.features[0],geometry:{type:'Point',coordinates:[NaN,2]}}]},{...valid,features:[{...valid.features[0],properties:{...valid.features[0].properties,heightM:-4}}]}]) assert.throws(()=>validateObstacleResult(bad,bounds));
});
test('combined demand uses one request with separate line/obstacle data and no repeated fetch', async () => {
 let calls=0; const bounds=getPowerLineQueryBounds(viewport);
 const h=harness(async url=>{calls++;assert.equal(new URL(url,'https://test').searchParams.get('obstacles'),'1');return {ok:true,json:async()=>payload(bounds)};});
 await Promise.all([h.runtime.update(viewport,true,true), h.runtime.update(viewport,true,true)]);
 assert.equal(calls,1); assert.equal(h.lines.status,'AVAILABLE'); assert.equal(h.obstacles.status,'AVAILABLE');
 assert.equal(h.lines.data.features[0].geometry.type,'LineString'); assert.equal(h.obstacles.data.features[0].id,'node/1');
 await h.runtime.update(viewport,true,true); assert.equal(calls,1);
});
test('old lines-only cache does not certify obstacle coverage; activating obstacles makes one upgrade request', async () => {
 let calls=0; const bounds=getPowerLineQueryBounds(viewport);
 const h=harness(async url=>{calls++;return {ok:true,json:async()=>new URL(url,'https://test').searchParams.has('obstacles') ? payload(bounds) : {...parsePowerLines({elements:[way]}),bounds,fetchedAt:stamp}};});
 await h.runtime.update(viewport,true,false); assert.equal(h.obstacles,undefined);
 await h.runtime.update(viewport,true,true); assert.equal(calls,2); assert.equal(h.obstacles.covered,true);
});
test('invalid obstacles do not break valid C10 lines; invalid lines do not discard validated obstacles', async () => {
 const bounds=getPowerLineQueryBounds(viewport);
 const a=harness(async()=>({ok:true,json:async()=>({...payload(bounds),obstacles:{}})}));
 await a.runtime.update(viewport,true,true); assert.equal(a.lines.status,'AVAILABLE'); assert.equal(a.obstacles.status,'UNAVAILABLE');
 const b=harness(async()=>({ok:true,json:async()=>({...payload(bounds),features:null})}));
 await b.runtime.update(viewport,true,true); assert.equal(b.lines.status,'UNAVAILABLE'); assert.equal(b.obstacles.status,'AVAILABLE');
});
test('HTTP failure/new area and offline mode preserve both downloaded collections and dates', async () => {
 let calls=0; const bounds=getPowerLineQueryBounds(viewport);
 const h=harness(async()=>{ if(++calls>1) throw new TypeError('network'); return {ok:true,json:async()=>payload(bounds)}; });
 await h.runtime.update(viewport,true,true);
 const elsewhere={west:4,south:51,east:4.1,north:51.1};
 await h.runtime.update(elsewhere,true,true);
 assert.equal(h.lines.data.features.length,1); assert.equal(h.obstacles.data.features.length,1);
 assert.equal(h.obstacles.status,'UNKNOWN_COVERAGE'); assert.equal(h.obstacles.fetchedAt,stamp.replace('Z','.000Z'));
 const before=calls;await h.runtime.update(viewport,false,true);assert.equal(calls,before);assert.equal(h.obstacles.offline,true);assert.equal(h.obstacles.covered,true);
});
test('capped obstacle bounds never certify a wider viewport and do not refetch the same capped area', async () => {
 let calls=0;const wide={west:2,south:50,east:4,north:52},bounds=getPowerLineQueryBounds(wide);
 const h=harness(async()=>{calls++;return {ok:true,json:async()=>payload(bounds,[],[])};});
 await h.runtime.update(wide,true,true);assert.equal(h.obstacles.covered,false);assert.equal(h.obstacles.status,'UNKNOWN_COVERAGE');
 await h.runtime.update(wide,true,true);assert.equal(calls,1);
 const capped=obstacleQueryBounds(bounds);assert.ok(capped.east-capped.west<=0.301);assert.match(buildObstaclesQuery(bounds),/out body center/);
});
test('stopped runtime never publishes a late obstacle response', async () => {
 let resolve;const response=new Promise(r=>{resolve=r;});const bounds=getPowerLineQueryBounds(viewport);
 const h=harness(()=>response);const pending=h.runtime.update(viewport,true,true);h.runtime.stop();const previous=h.obstacles;
 resolve({ok:true,json:async()=>payload(bounds)});await pending;assert.equal(h.obstacles,previous);
});
test('partial obstacle response is retained and repeated viewport events do not retry immediately', async () => {
 let calls=0;const bounds=getPowerLineQueryBounds(viewport);
 const h=harness(async()=>{calls++;const data=payload(bounds);data.obstacles.complete=false;data.obstacles.rejectedElements=1;return {ok:true,json:async()=>data};});
 await h.runtime.update(viewport,true,true);assert.equal(h.obstacles.status,'INCOMPLETE');assert.equal(h.obstacles.data.features.length,1);
 await h.runtime.update(viewport,true,true);assert.equal(calls,1);
 h.store.obstacles.retryAfter.clear();
 await h.runtime.update(viewport,true,true);assert.equal(calls,2);
});
