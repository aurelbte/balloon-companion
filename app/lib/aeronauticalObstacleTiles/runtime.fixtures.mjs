// Node-only test support. Data are retained real subsets, except explicitly synthetic Preuseville.
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {buildTiles} from '../../../prototypes/aeronautical-obstacles/tile-build.mjs';
import {normalizeSia,normalizeOsm,relateRecords,canonical,sha256} from '../../../prototypes/aeronautical-obstacles/normalize.ts';
export async function datasets() {
 const root=await mkdtemp('/tmp/bc-obstacle-runtime-');const result={root};
 for(const zone of ['preuseville','le-havre','grenoble']) {
  const real=zone!=='preuseville';
  const rawBytes=real?await readFile(new URL(`../../../prototypes/aeronautical-obstacles/fixtures/${zone}.json`,import.meta.url)):Buffer.from(JSON.stringify({sia:[{IDENTIFICATEUR:'synthetic-runtime-only',TYPE:'Mât',NOMBRE:'1','LONGITUDE DECIMALE':'1.5047','LATITUDE DECIMALE':'49.8804','SYSTEME DE REFERENCE HORIZONTALE':'WGS84'}],osm:[]}));
  const raw=JSON.parse(rawBytes),source=join(root,`${zone}-input`);await mkdir(source);
  const centre=zone==='preuseville'?[1.5047,49.8804]:zone==='le-havre'?[.1078,49.4943]:[5.727412,45.190836];
  const radiusM=zone==='grenoble'?20000:real?15000:1000;
  const records=[...raw.sia.map(r=>normalizeSia(r,['retained-SIA'])),...raw.osm.map(r=>normalizeOsm(r,['retained-OSM'])).filter(Boolean)];
  const links=relateRecords(records),artifacts={};
  const values={'records.json':records,'links.json':links,'excluded.json':[],'outside.json':[],'divergences.json':links.filter(l=>l.heightComparison?.reviewRequired),'statistics.json':{records:records.length},'obstacles.geojson':{type:'FeatureCollection',features:records.map(r=>({type:'Feature',id:r.observationId,geometry:r.geometry,properties:{recordId:r.id}}))}};
  for(const[k,v]of Object.entries(values)) {const bytes=Buffer.from(canonical(v)+'\n');await writeFile(join(source,k),bytes);artifacts[k]={bytes:bytes.length,sha256:sha256(bytes)};}
  const identity={zone,centre,radiusM,scope:real?'committed_real_subset_only':'synthetic_test_only',retainedSourceProvenance:raw.provenance??null};
  const sources=[...new Set(records.map(r=>r.source))].map(s=>({id:`retained-${s}`,source:s,url:real&&s==='OSM'&&raw.provenance.osm_sources?.length===1?raw.provenance.osm_sources[0].url??null:null,artifact:real?`${zone}.json`:'synthetic-runtime-only.json',sha256:sha256(rawBytes),referenceDate:real&&s==='SIA'?raw.provenance.sia_cycle:null,airacCycle:real&&s==='SIA'?raw.provenance.sia_cycle:null,snapshotAtUtc:real&&s==='OSM'&&raw.provenance.osm_sources?.length===1?raw.provenance.osm_sources[0].snapshot_utc??null:null,retrievedAtUtc:null,license:real&&s==='OSM'?'ODbL-1.0':null,attribution:real?raw.notice:'Explicitly synthetic test only; no real Preuseville data available'}));
  await writeFile(join(source,'manifest.json'),canonical({schemaVersion:2,dataset:`${zone}-aeronautical-obstacles-local`,identity,version:sha256(canonical(identity)),sources,summary:{records:records.length,sourceRecords:Object.fromEntries(sources.map(s=>[s.source,records.filter(r=>r.source===s.source).length])),excluded:{}},limitations:[real?'Retained real subset, not full original zone':'Synthetic Preuseville, not operational data'],artifacts})+'\n');
  const output=await buildTiles(source,join(root,'tiles')),manifestBytes=await readFile(join(output.output,'manifest.json')),manifest=JSON.parse(manifestBytes);
  const files=new Map([['manifest.json',manifestBytes]]);
  for(const e of manifest.tiling.tiles)files.set(e.key,await readFile(join(output.output,e.key)));
  result[zone]={...output,manifest,manifestBytes,files,records,centre,radiusM,real};
 }
 return result;
}
export function server(data) {
 const calls=[],pending=[];let handler;
 return {calls,pending,setHandler(fn){handler=fn;},fetch:async(url,init)=>{
  const path=new URL(url).pathname.replace('/dataset/','');calls.push({path,signal:init.signal});
  if(handler){const result=await handler(path,init);if(result!==undefined)return result;}
  const bytes=data.files.get(path);return bytes?new Response(bytes,{headers:{'content-type':path.endsWith('.geojson')?'application/geo+json':'application/json'}}):new Response('',{status:404});
 }};
}
export const box=(entry)=>({west:entry.bbox[0],south:entry.bbox[1],east:entry.bbox[2],north:entry.bbox[3]});
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
