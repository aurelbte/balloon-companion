import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { normalizeSia, normalizeOsm, canonical, sha256 } from './normalize.ts';
import { makeTiles, representations, TILE_POLICY } from './tiles.ts';
import { tileXY, tileBounds, boundsRing, polygonTileIntersection, clipLineToTile } from './tileGeometry.ts';
import { buildTiles } from './tile-build.mjs';

// Explicitly synthetic fixtures for geometry/packaging tests; no fixture is used in production outputs.
const point = (id, lon = 0, lat = 0, extra = {}) => normalizeSia({ IDENTIFICATEUR: id, TYPE: 'Mât', NOMBRE: '1',
  'LONGITUDE DECIMALE': String(lon), 'LATITUDE DECIMALE': String(lat), 'SYSTEME DE REFERENCE HORIZONTALE': 'WGS84',
  'HAUTEUR HORS SOL': '100', 'ALTITUDE AU SOMMET': '1000', UNITE: 'FT', 'SYSTEME REFERENCE VERTICALE': 'IGN69', ...extra }, ['test']);
const cable = (id = 'way/1', coordinates = [[-0.1,-0.1],[0,0],[0.1,0.1]]) => normalizeOsm({ id, longitude: 0, latitude: 0,
  osm_version: 1, tags: { aerialway: 'zip_line' }, geometry: { type: 'LineString', coordinates } }, ['test']);
const link = (a, b, decision = 'candidate') => ({ id: `link:${a.sourceId}:${b.sourceId}`, fromObservationId: a.observationId,
  toObservationId: b.observationId, relation: 'possible_same_object', decision, method: 'synthetic-reviewed-test',
  evidence: ['explicit_identity_review_for_test'], alternatives: [], distanceM: 0, distanceMethod: 'point_haversine', heightComparison: null });

test('XYZ points have a unique east/south boundary owner at both zooms, including tile corners', () => {
  for (const z of [9,12]) {
    assert.deepEqual(tileXY(0,0,z), [2**(z-1),2**(z-1)]);
    const box = tileBounds(z,17,22);
    assert.deepEqual(tileXY(box[0],box[3],z),[17,22]);
  }
  const p=point('boundary'), result=makeTiles([p],[],[0,0],1000);
  for (const z of [9,12]) {
    const owners=result.tiles.filter(t=>t.z===z&&t.features.some(f=>f.properties.memberObservationIds.includes(p.observationId)));
    assert.equal(owners.length,1); assert.deepEqual([owners[0].x,owners[0].y],tileXY(0,0,z));
  }
});

test('clipped lines preserve all length, native interior vertices and stable fragment IDs', () => {
  const r=cable(), before=canonical(r), first=makeTiles([r],[],[0,0],1000), second=makeTiles([r],[],[0,0],1000);
  assert.equal(canonical(first),canonical(second)); assert.equal(canonical(r),before);
  for (const z of [9,12]) {
    let total=0;
    const fragments=first.tiles.filter(t=>t.z===z).flatMap(t=>t.features.map(f=>({t,f})));
    assert.ok(fragments.length>=2);
    for (const {t,f} of fragments) {
      assert.equal(f.properties.fragmentOf,r.observationId);
      assert.ok(f.id.includes(`/fragment/${z}/${t.x}/${t.y}/`));
      const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
      const b=tileBounds(z,t.x,t.y);
      for (const line of lines) {
        assert.ok(line.length>=2);
        assert.ok(line.every(p=>p.length===2&&p[0]>=b[0]-1e-12&&p[0]<=b[2]+1e-12&&p[1]>=b[1]-1e-12&&p[1]<=b[3]+1e-12));
        for(let i=1;i<line.length;i++)total+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);
      }
    }
    assert.ok(Math.abs(total-Math.hypot(.2,.2))<1e-10);
  }
  assert.deepEqual(clipLineToTile([[[.001,-.001],[.002,-.002],[.003,-.003]]],12,...tileXY(.002,-.002,12)),[[[.001,-.001],[.002,-.002],[.003,-.003]]]);
});

test('boundary-aligned lines and corner tangencies never duplicate segments or produce zero-length fragments', () => {
  for (const coordinates of [[[0,-.1],[0,.1]],[[-.1,0],[.1,0]]]) {
    const data=makeTiles([cable('way/2',coordinates)],[],[0,0],1000);
    for(const z of [9,12]) {
      const features=data.tiles.filter(t=>t.z===z).flatMap(t=>t.features);
      let length=0;
      for(const f of features)for(const line of f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates)
        for(let i=1;i<line.length;i++)length+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);
      assert.ok(Math.abs(length-.2)<1e-10);
    }
  }
  const box=tileBounds(12,2048,2048);
  assert.deepEqual(clipLineToTile([[[-.1,-.1],[.1,.1]]],12,2048,2048),[]); // Only touches north-west corner.
  assert.ok(box[0]===0&&box[3]===0);
});

test('only explicit confirmed identity shares a representation; candidates, scopes and original measurements survive', () => {
  const a=point('a'), b=point('b',.00001);
  assert.equal(representations([a,b],[link(a,b)]).representations.length,2);
  assert.equal(representations([a,b],[link(a,b,'ambiguous')]).representations.length,2);
  const confirmed=representations([a,b],[link(a,b,'confirmed')]);
  assert.equal(confirmed.representations.length,1); assert.equal(confirmed.representations[0].records.length,2);
  const one=makeTiles([a,b],[link(a,b,'confirmed')],[0,0],1000).tiles.filter(t=>t.z===12).flatMap(t=>t.features);
  assert.equal(one.length,1); assert.equal(one[0].properties.representation,'confirmed_identity');
  assert.equal(one[0].properties.observations.length,2);
  assert.equal(representations([a,a],[]).exactDuplicates,1);
  assert.throws(()=>representations([a,{...a,name:'conflicting'}],[]),/CONFLICTING_OBSERVATION_ID/);
  const group=point('group',0,0,{NOMBRE:'2'});
  assert.throws(()=>representations([a,group],[link(a,group,'confirmed')]),/CONFIRMED_IDENTITY_REQUIRES_REVIEW/);
  const data=makeTiles([a,group],[],[0,0],1000);
  const classes=new Set(data.tiles.filter(t=>t.z===12).flatMap(t=>t.features.map(f=>f.properties.featureClass)));
  assert.deepEqual([...classes].sort(),['groups','points']);
});

test('overview explicitly references unknown-height members; full details preserve AGL, AMSL, raw units and null datum', () => {
  const a=point('a'), b=point('b',.0001,0,{'HAUTEUR HORS SOL':'','SYSTEME REFERENCE VERTICALE':''});
  const data=makeTiles([a,b],[],[0,0],1000);
  assert.equal(canonical(data),canonical(makeTiles([b,a],[],[0,0],1000)));
  const overview=data.tiles.filter(t=>t.z===9).flatMap(t=>t.features);
  assert.equal(overview.length,1); assert.equal(overview[0].properties.representation,'cartographic_aggregate');
  assert.equal(overview[0].properties.sourceRecordCount,2); assert.equal(overview[0].properties.physicalObjectCount,null);
  assert.equal(overview[0].properties.unknownAglCount,1);
  const details=data.tiles.filter(t=>t.z===12).flatMap(t=>t.features);
  assert.equal(details.length,2);
  for(const record of [a,b]){
    const observation=details.flatMap(f=>f.properties.observations).find(o=>o.observationId===record.observationId);
    assert.deepEqual(observation.measurements,record.measurements);
    assert.deepEqual(observation.sourceEditionIds,['test']);
  }
  assert.equal(details.flatMap(f=>f.properties.observations).find(o=>o.sourceId==='b').measurements.topAmsl.datum,null);
});

test('coverage has positive area, explicit empty cells and separate native trace extensions', () => {
  const r=cable('way/3',[[0,0],[1,0]]), data=makeTiles([r],[],[0,0],1000);
  assert.ok(data.tiles.some(t=>!t.features.length));
  assert.ok(data.tiles.some(t=>t.coverage==='native_data_extension'&&t.features.length));
  assert.ok(data.tiles.filter(t=>t.coverage==='native_data_extension').every(t=>t.features.length));
  const ring=boundsRing([0,0,1,1]);
  assert.deepEqual(polygonTileIntersection(ring,[1,0,2,1]),[]); // Shared edge is not an area.
  assert.ok(polygonTileIntersection(ring,[.5,.5,2,2]).length>=4);
  const empty=makeTiles([],[],[0,0],1000);
  assert.ok(empty.tiles.length>0&&empty.tiles.every(t=>t.features.length===0));
  const invalid=point('3d'); invalid.geometry.coordinates.push(100);
  assert.throws(()=>makeTiles([invalid],[],[0,0],1000),/INVALID_OR_NON_2D_GEOMETRY/);
});

test('real Grenoble native routes and SIA points retain distinct representations through both levels', async()=>{
  const raw=JSON.parse(await readFile(new URL('./fixtures/grenoble.json',import.meta.url),'utf8'));
  const points=raw.sia.filter(r=>r.TYPE==='Câble').map(r=>normalizeSia(r,['test']));
  const routes=raw.osm.filter(r=>r.geometry?.type==='LineString').map(r=>normalizeOsm(r,['test']));
  const data=makeTiles([...points,...routes],[],[5.727412,45.190836],20000);
  assert.equal(data.index.representations.length,7);
  for(const z of [9,12]){
    const features=data.tiles.filter(t=>t.z===z).flatMap(t=>t.features);
    const members=new Set(features.flatMap(f=>f.properties.memberObservationIds));
    assert.equal(members.size,7);
    assert.ok(features.filter(f=>f.properties.fragmentOf).every(f=>f.properties.observations.every(r=>r.verticalProfile==='unknown')));
  }
});

test('real Le Havre groups, composites, building components and all 13 unknown-height cranes survive detail tiles', async()=>{
  const raw=JSON.parse(await readFile(new URL('./fixtures/le-havre.json',import.meta.url),'utf8'));
  const rows=[...raw.sia.map(r=>normalizeSia(r,['test'])),...raw.osm.map(r=>normalizeOsm(r,['test'])).filter(Boolean)];
  const data=makeTiles(rows,[],[.1078,49.4943],15000);
  const features=data.tiles.filter(t=>t.z===12).flatMap(t=>t.features);
  const classes=new Set(features.map(f=>f.properties.featureClass));
  for(const kind of ['points','groups','composites','components'])assert.ok(classes.has(kind));
  const cranes=features.filter(f=>f.properties.category==='crane');
  assert.equal(cranes.length,13);
  assert.ok(cranes.every(f=>f.properties.unknownAglCount===1&&f.properties.unknownDeclaredHeightCount===1));
  assert.ok(cranes.every(f=>f.properties.observations[0].permanence==='unknown'));
  assert.equal(new Set(features.flatMap(f=>f.properties.memberObservationIds)).size,rows.length);
});

async function normalizedFixture(t){
  const root=await mkdtemp('/tmp/bc-obstacle-tiles-test-');t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'normalized');await mkdir(source);
  const records=[point('p')], artifacts={};
  const values={'records.json':records,'links.json':[],'excluded.json':[],'outside.json':[],'divergences.json':[],
    'statistics.json':{records:1},'obstacles.geojson':{type:'FeatureCollection',features:[]}};
  for(const[key,value]of Object.entries(values)){
    const bytes=Buffer.from(JSON.stringify(value)+'\n');await writeFile(join(source,key),bytes);
    artifacts[key]={bytes:bytes.length,sha256:sha256(bytes)};
  }
  const identity={zone:'preuseville',centre:[0,0],radiusM:1000};
  const sources=[{id:'test',source:'SIA',url:null,artifact:'synthetic',sha256:'0'.repeat(64),referenceDate:null,airacCycle:null,snapshotAtUtc:null,retrievedAtUtc:null,license:null,attribution:'Synthetic fixture only'}];
  await writeFile(join(source,'manifest.json'),JSON.stringify({schemaVersion:2,dataset:'preuseville-aeronautical-obstacles-local',identity,
    version:sha256(canonical(identity)),sources,summary:{records:1,sourceRecords:{SIA:1},excluded:{}},limitations:['Synthetic fixture'],artifacts}));
  return{root,source};
}

test('packaging is deterministic including gzip, hashes, manifests and empty files; refuses overwrite',async t=>{
  const{root,source}=await normalizedFixture(t);
  const first=await buildTiles(source,join(root,'a')),second=await buildTiles(source,join(root,'b'));
  assert.equal(first.version,second.version);
  const m=JSON.parse(await readFile(join(first.output,'manifest.json'),'utf8'));
  assert.equal(m.redistribution.publicRedistributionValidated,false);
  assert.ok((await readFile(join(first.output,'manifest.json'))).equals(await readFile(join(second.output,'manifest.json'))));
  assert.ok(m.tiling.tiles.some(t=>t.status==='empty'));
  assert.ok((await readFile(join(first.output,'normalized/records.json'))).equals(await readFile(join(source,'records.json'))));
  for(const[key,entry]of Object.entries(m.artifacts)){
    const bytes=await readFile(join(first.output,key));assert.equal(sha256(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);
    assert.ok(bytes.equals(await readFile(join(second.output,key))));
    if(key.endsWith('.gz'))assert.equal(sha256(gunzipSync(bytes)),entry.decodedSha256);
  }
  for(const tile of m.tiling.tiles){
    const data=JSON.parse(await readFile(join(first.output,tile.key),'utf8'));
    assert.equal(data.features.length,tile.features);assert.equal(tile.status,data.features.length?'data':'empty');
    assert.equal(new Set(data.features.map(f=>f.id)).size,data.features.length);
  }
  const coverage=JSON.parse(await readFile(join(first.output,'coverage.geojson'),'utf8'));
  assert.equal(coverage.features.length,m.tiling.tiles.length+1);
  assert.deepEqual(coverage.features.slice(1).map(f=>f.id).sort(),m.tiling.tiles.map(t=>t.key).sort());
  await assert.rejects(buildTiles(source,join(root,'a')),/IMMUTABLE_OUTPUT_EXISTS/);
  assert.ok((await readdir(join(root,'a','preuseville'))).every(name=>!name.startsWith('.building-')));
});

test('input tampering is rejected before any output is produced',async t=>{
  const{root,source}=await normalizedFixture(t);
  await writeFile(join(source,'records.json'),'[]');
  await assert.rejects(buildTiles(source,join(root,'out')),/NORMALIZED_SHA256_MISMATCH/);
  await assert.rejects(readdir(join(root,'out')),{code:'ENOENT'});
});
