import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
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
  const maps=[],markers=[],confirmed=[];
  class MapMock {
    constructor(options){this.options=options;this.layers=new Map(options.style.layers.map(l=>[l.id,l]));this.sources={};this.handlers={};this.removed=0;maps.push(this);}
    on(event,fn){(this.handlers[event]??=[]).push(fn);}
    emit(event,payload={}){for(const fn of this.handlers[event]??[])fn(payload);}
    addSource(id,specification){this.sources[id]={...specification,reloads:0,setTiles(tiles){this.tiles=tiles;this.reloads++;}};}
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
  const mocks={react,'maplibre-gl':{Map:MapMock,Marker:MarkerMock},'maplibre-gl/dist/maplibre-gl.css':{},'next/image':()=>null,'lucide-react':{Check:()=>null,LocateFixed:()=>null,Navigation:()=>null,X:()=>null},'../../lib/launchPointBaseMap':baseMap};
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
  t.after(()=>slots.forEach(s=>s?.cleanup?.()));render();
  return {maps,markers,confirmed,radio,select,render,find,get map(){return maps[0];},source:()=>maps[0].getSource(baseMap.LAUNCH_SATELLITE_SOURCE)};
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
