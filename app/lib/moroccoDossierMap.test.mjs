import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMoroccoDossierMap, moroccoSatelliteTileUrl } from './moroccoDossierMap.ts';
import { renderFlightDossierMap } from './moroccoFlightDossierExport.ts';
const zone=JSON.parse(readFileSync(new URL('../../public/geo/zone-vol-bourrous.geojson',import.meta.url)));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==','base64');
const points=Array.from({length:5},(_,i)=>({timestamp:Date.parse('2026-11-10T06:00:00Z')+i*15*60000,latitude:31.72+i*.01,longitude:-7.94+i*.055,altitudeMeters:600}));
async function withCanvas(run,{online=true,failTile=false,failZone=false}={}) {
  const originals=Object.fromEntries(['document','navigator','fetch','createImageBitmap'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const calls=[],requests=[];let canvas;let strokeStyle;let fillStyle;let currentPath=[];
  const context=new Proxy({}, {get:(_,key)=> (...args)=>{
    if(key==='beginPath')currentPath=[];
    if(['moveTo','lineTo','closePath'].includes(key))currentPath.push([key,...args]);
    calls.push({key,args,strokeStyle,fillStyle,path:key==='stroke'||key==='fill'?structuredClone(currentPath):undefined});
  },set:(_,key,value)=>{if(key==='strokeStyle')strokeStyle=value;if(key==='fillStyle')fillStyle=value;return true;}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas={width:0,height:0,getContext:()=>context,toBlob:cb=>cb(new Blob([png]))}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:online}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async url=>{requests.push(url);return url.startsWith('/geo/')?{ok:!failZone,json:async()=>zone}:{ok:!failTile,blob:async()=>new Blob([png])};}});
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({close(){calls.push({key:'closeImage'});}})});
  try {await run({calls,requests,get canvas(){return canvas;}});} finally {for(const [k,d] of Object.entries(originals)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
}

test('Morocco satellite keeps exact local violet polygon under original trajectory, endpoints, time markers and scale',async()=>{
  await withCanvas(async h=>{
    const before=JSON.stringify(points);const result=await renderMoroccoDossierMap(points);
    assert.equal(result.background,'SATELLITE');assert.equal(h.canvas.width,1400);assert.equal(h.canvas.height,1850);
    assert.equal(JSON.stringify(points),before);
    assert.equal(h.requests[0],'/geo/zone-vol-bourrous.geojson');
    const tiles=h.requests.slice(1);assert.ok(tiles.length>0);assert.ok(tiles.every(url=>url.includes('/s2cloudless_3857/')&&url.endsWith('.jpg')));
    assert.ok(!tiles.some(url=>url.includes('openstreetmap')||url.includes('key=')));
    const purple=h.calls.findIndex(c=>c.key==='stroke'&&c.strokeStyle==='#c084fc');
    const trajectory=h.calls.findIndex(c=>c.key==='stroke'&&c.strokeStyle==='rgba(7,17,31,.72)');assert.ok(purple>=0&&purple<trajectory);
    const ring=zone.features[0].geometry.coordinates[0];assert.equal(h.calls[purple].path.filter(p=>p[0]==='lineTo').length,ring.length-1);
    assert.equal(h.calls[trajectory].path.filter(p=>p[0]==='lineTo').length,points.length-1);
    const texts=h.calls.filter(c=>c.key==='fillText').map(c=>c.args[0]);
    for(const text of ['D','A','15 min','30 min','45 min'])assert.ok(texts.includes(text),text);
    assert.ok(texts.some(t=>t.includes('(au centre)')));assert.ok(texts.some(t=>t.includes('EOX IT Services GmbH')));assert.ok(texts.some(t=>t.includes('CC BY 4.0')));
    assert.ok(h.calls.some(c=>c.key==='closeImage'));
  });
});

for(const online of [true,false])test(`satellite unavailable (online=${online}): keep violet zone and route; no misleading OSM fallback`,async()=>{
  await withCanvas(async h=>{
    const result=await renderMoroccoDossierMap(points);assert.equal(result.background,'NEUTRAL');
    assert.ok(h.calls.some(c=>c.key==='stroke'&&c.strokeStyle==='#c084fc'));
    assert.ok(h.calls.some(c=>c.key==='fillText'&&c.args[0].includes('Satellite indisponible')));
    assert.ok(!h.calls.some(c=>c.key==='drawImage'));
  },{online,failTile:true});
});

test('missing polygon or cancellation is explicit; invalid coordinates are rejected',async()=>{
  await withCanvas(async()=>{await assert.rejects(renderMoroccoDossierMap(points),/Zone de vol indisponible/);},{failZone:true});
  await withCanvas(async()=>{
    const controller=new AbortController();controller.abort();await assert.rejects(renderMoroccoDossierMap(points,controller.signal),{name:'AbortError'});
    await assert.rejects(renderMoroccoDossierMap([{...points[0],latitude:89}]),/Projection cartographique/);
  });
});

test('Morocco export entry uses this satellite renderer; WMTS URL preserves y/x order',async()=>{
  assert.equal(moroccoSatelliteTileUrl(9,244,208),'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/9/208/244.jpg');
  await withCanvas(async h=>{
    const result=await renderFlightDossierMap(points.map(p=>({latitude:p.latitude,longitude:p.longitude,timestamp:new Date(p.timestamp).toISOString(),altitudeAmslM:600})));
    assert.equal(result.background,'SATELLITE');assert.ok(h.requests.length>1);
  });
});

test('Mac and iPhone render the same fixed-resolution portrait map, independent of viewport and pixel ratio',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  try {
    const sizes=[];
    for(const [innerWidth,devicePixelRatio] of [[1440,2],[390,3]]) {
      Object.defineProperty(globalThis,'window',{configurable:true,value:{innerWidth,devicePixelRatio}});
      await withCanvas(async h=>{await renderMoroccoDossierMap(points);sizes.push([h.canvas.width,h.canvas.height,h.requests.length]);});
    }
    assert.deepEqual(sizes[0],sizes[1]);assert.deepEqual(sizes[0].slice(0,2),[1400,1850]);
  } finally {if(original)Object.defineProperty(globalThis,'window',original);else delete globalThis.window;}
});
