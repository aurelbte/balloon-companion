import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import { preparationPowerLineStatusLabel } from '../../lib/tiledPowerLineStatus.ts';
import * as baseMap from '../../lib/launchPointBaseMap.ts';
const require=createRequire(import.meta.url);
function harness(t,key='test-key') {
  const old=process.env.NEXT_PUBLIC_MAPTILER_KEY;
  process.env.NEXT_PUBLIC_MAPTILER_KEY=key;
  t.after(()=>{if(old===undefined)delete process.env.NEXT_PUBLIC_MAPTILER_KEY;else process.env.NEXT_PUBLIC_MAPTILER_KEY=old;});
  const slots=[];let cursor=0;let pending=[];
  const react={...require('react'),
    useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
    useEffect(fn,deps){const i=cursor++;const previous=slots[i];if(!previous||deps.some((d,j)=>d!==previous.deps[j])){slots[i]={deps};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
  };
  const maps=[],markers=[],confirmed=[],runtimes=[],networkListeners=new Map();
  const oldWindow=globalThis.window;
  globalThis.window={addEventListener:(e,fn)=>networkListeners.set(e,fn),removeEventListener:e=>networkListeners.delete(e)};
  class RuntimeMock {
    constructor(publish){this.publish=publish;this.requests=[];this.stops=0;runtimes.push(this);}
    update(...args){this.requests.push(args);}
    stop(){this.stops++;}
  }
  class MapMock {
    constructor(options){this.options=options;this.layers=new Map(options.style.layers.map(l=>[l.id,l]));this.sources={};this.handlers={};this.removed=0;maps.push(this);}
    on(event,fn){(this.handlers[event]??=[]).push(fn);}
    off(event,fn){this.handlers[event]=(this.handlers[event]??[]).filter(f=>f!==fn);}
    isStyleLoaded(){return this.ready??false;}
    getZoom(){return 14;}
    getBounds(){return {getWest:()=>3,getEast:()=>3.1,getSouth:()=>50,getNorth:()=>50.1};}
    emit(event,payload={}){if(event==='load')this.ready=true;for(const fn of this.handlers[event]??[])fn(payload);}
    addSource(id,specification){this.sources[id]={...specification,setData(data){this.data=data;},reloads:0,setTiles(tiles){this.tiles=tiles;this.reloads++;}};}
    getSource(id){return this.sources[id];}
    addLayer(layer){this.layers.set(layer.id,layer);}
    getLayer(id){return this.layers.get(id);}
    setLayoutProperty(id,k,v){this.layers.get(id).layout??={};this.layers.get(id).layout[k]=v;}
    remove(){this.removed++;}
  }
  class MarkerMock {
    constructor(){this.handlers={};markers.push(this);}
    setLngLat(p){this.point={lng:p[0],lat:p[1]};return this;}
    addTo(){return this;}
    on(event,fn){this.handlers[event]=fn;}
    getLngLat(){return this.point;}
  }
  const mocks={react,'../../lib/flightPowerLines':{FlightPowerLineRuntime:RuntimeMock,FLIGHT_POWER_LINE_MIN_ZOOM:8},'../../lib/tiledPowerLineStatus':{preparationPowerLineStatusLabel},'maplibre-gl':{Map:MapMock,Marker:MarkerMock},'maplibre-gl/dist/maplibre-gl.css':{},'next/image':()=>null,'lucide-react':{Check:()=>null,LocateFixed:()=>null,Navigation:()=>null,X:()=>null},'../../lib/launchPointBaseMap':baseMap};
  const source=readFileSync(new URL('./LaunchPointMapDialog.tsx',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',js)(id=>id in mocks?mocks[id]:require(id),exports);
  const point={id:'site',name:'Terrain',latitude:31.78,longitude:-7.8};
  let tree;
  const props={initialPoint:point,allowBaseMapSelection:true,onCancel(){},onConfirm:p=>confirmed.push(p)};
  function walk(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const child of [node.props?.children].flat(Infinity))walk(child,fn);}
  const render=()=>{cursor=0;tree=exports.default(props);walk(tree,n=>{if(n.type==='div'&&n.props.ref)n.props.ref.current={};});const effects=pending;pending=[];effects.forEach(fn=>fn());return tree;};
  const find=predicate=>{let result;walk(tree,n=>{if(predicate(n))result=n;});return result;};
  const radio=value=>find(n=>n.type==='input'&&n.props.value===value);
  const select=value=>{radio(value).props.onChange();render();};
  t.after(()=>{slots.forEach(s=>s?.cleanup?.());globalThis.window=oldWindow;});render();
  return {maps,markers,confirmed,runtimes,networkListeners,radio,select,render,find,get map(){return maps[0];},source:()=>maps[0].getSource(baseMap.LAUNCH_SATELLITE_SOURCE)};
}
const error=()=>({sourceId:baseMap.LAUNCH_SATELLITE_SOURCE,error:new Error('Tile unavailable')});

test('one or two errors keep satellite; third within ten seconds restores Plan without permanently disabling Satellite',t=>{
  const h=harness(t);h.map.emit('load');h.select('satellite');
  h.map.emit('error',error());h.render();assert.equal(h.radio('satellite').props.checked,true);
  h.map.emit('error',error());h.render();assert.equal(h.radio('satellite').props.checked,true);
  h.map.emit('error',error());h.render();assert.equal(h.radio('plan').props.checked,true);assert.equal(h.radio('satellite').props.disabled,false);
  assert.equal(h.map.getLayer(baseMap.LAUNCH_SATELLITE_LAYER).layout.visibility,'none');
  assert.ok(h.find(n=>n.props?.role==='status'&&String(n.props.children).includes('réessayer')));
});

test('retry reloads identical Hybrid tiles, resets errors and preserves the map, marker and confirmed coordinates',t=>{
  const h=harness(t);h.map.emit('load');h.select('satellite');for(let i=0;i<3;i++)h.map.emit('error',error());h.render();
  const tiles=[...h.source().tiles];h.select('satellite');
  assert.equal(h.source().reloads,1);assert.deepEqual(h.source().tiles,tiles);assert.ok(tiles[0].includes('/hybrid-v4/256/'));
  assert.equal(h.maps.length,1);assert.equal(h.markers.length,1);assert.equal(h.map.removed,0);assert.equal(h.find(n=>n.props?.role==='status'),undefined);
  for(let i=0;i<2;i++)h.map.emit('error',error());h.render();assert.equal(h.radio('satellite').props.checked,true);
  h.map.emit('click',{lngLat:{lng:-7.81,lat:31.79}});h.render();
  h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Valider ce point')).props.onClick();
  assert.equal(h.confirmed[0].latitude,31.79);assert.equal(h.confirmed[0].longitude,-7.81);
});

test('expired, unrelated and Plan errors do not cause a premature fallback; successful loading clears accumulated errors',t=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const h=harness(t);h.map.emit('load');h.map.emit('error',error());h.select('satellite');
  h.map.emit('error',error());now=10001;h.map.emit('error',error());h.map.emit('error',{sourceId:'osm-tiles',error:new Error('OSM unavailable')});h.render();assert.equal(h.radio('satellite').props.checked,true);
  h.map.emit('sourcedata',{sourceId:baseMap.LAUNCH_SATELLITE_SOURCE,isSourceLoaded:true});
  h.map.emit('error',error());h.map.emit('error',error());h.render();assert.equal(h.radio('satellite').props.checked,true);
});

test('without MapTiler key, Satellite remains disabled and no source is created',t=>{
  const h=harness(t,'');h.map.emit('load');assert.equal(h.radio('satellite').props.disabled,true);assert.equal(h.source(),undefined);
});

test('/prepare and favorite-terrain picker both explicitly enable the same Plan/Satellite selector',()=>{
  for(const relative of ['../../prepare/page.tsx','./TerrainSelector.tsx']) {
    const source=readFileSync(new URL(relative,import.meta.url),'utf8');
    const dialog=source.match(/<LaunchPointMapDialog\b[^>]*>/s)?.[0];assert.ok(dialog,relative);assert.match(dialog,/\ballowBaseMapSelection\b/);
  }
});


test('power filter loads shared tiles by viewport only when enabled, preserves marker and satellite, and reports partial/errors',t=>{
  const h=harness(t);h.map.emit('load');
  assert.equal(h.runtimes.length,0);
  const toggle=value=>{h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:value}});h.render();};
  h.select('satellite');toggle(true);
  const runtime=h.runtimes[0];
  assert.deepEqual(runtime.requests[0],[{west:3,south:50,east:3.1,north:50.1},navigator.onLine,false,true,14]);
  assert.equal(h.map.getLayer('launch-power-line').paint['line-color'],'#dc2626');
  assert.equal(h.map.getLayer('launch-power-casing').paint['line-color'],'rgba(7, 17, 31, 0.82)');
  const ids=[...h.map.layers.keys()];assert.ok(ids.indexOf('launch-power-line')>ids.indexOf(baseMap.LAUNCH_SATELLITE_LAYER));
  for(const label of ['Couverture partielle — non exhaustive','2 erreurs réseau — couverture non vérifiée']){
    const data={type:'FeatureCollection',features:[]};
    runtime.publish({data,localCoverage:'PARTIAL',coverageLabel:label});h.render();
    assert.equal(h.map.getSource('launch-power-lines').data,data);
    assert.ok(h.find(n=>n.props?.role==='status'&&String(n.props.children).includes(label)));
  }
  h.map.emit('moveend');h.networkListeners.get('offline')();assert.equal(runtime.requests.length,3);
  toggle(false);assert.equal(runtime.stops,1);assert.equal(h.networkListeners.size,0);
  assert.equal(h.map.getLayer('launch-power-line').layout.visibility,'none');
  h.map.emit('moveend');assert.equal(runtime.requests.length,3);
  toggle(true);assert.equal(h.maps.length,1);assert.equal(h.markers.length,1);
  assert.equal(h.map.getLayer(baseMap.LAUNCH_SATELLITE_LAYER).layout.visibility,'visible');
  h.map.emit('click',{lngLat:{lng:3.05,lat:50.05}});h.render();
  h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Valider ce point')).props.onClick();
  assert.equal(h.confirmed[0].longitude,3.05);assert.equal(h.confirmed[0].latitude,50.05);
});

test('power filter before style load is deferred and cancelled without loading when switched off',t=>{
  const h=harness(t);
  const toggle=value=>{h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:value}});h.render();};
  toggle(true);assert.equal(h.runtimes[0].requests.length,0);
  toggle(false);h.map.emit('load');assert.equal(h.runtimes[0].requests.length,0);
  assert.equal(h.map.getSource('launch-power-lines'),undefined);
  toggle(true);assert.equal(h.runtimes[1].requests.length,1);
});
