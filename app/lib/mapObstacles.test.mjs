import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function setup() {
 const sources=new Map(),layers=[],popups=[],queries=[];
 let zoom=12,feature;
 const map={
  addSource:(id,value)=>sources.set(id,value),addLayer:layer=>layers.push(layer),getLayer:id=>layers.find(l=>l.id===id),
  setLayoutProperty:(id,key,value)=>{map.getLayer(id).layout[key]=value;},getLayoutProperty:(id,key)=>map.getLayer(id).layout[key],
  getZoom:()=>zoom,queryRenderedFeatures:(box,options)=>{queries.push({box,options});return feature?[feature]:[];},
 };
 class Popup {
  constructor(){this.content={style:{}};this.close={style:{}};this.element={style:{},querySelector:s=>s.includes('close-button')?this.close:this.content};popups.push(this);}
  setLngLat(coords){this.coords=coords;return this;}setText(text){this.text=text;return this;}addTo(){return this;}getElement(){return this.element;}remove(){this.removed=true;}
 }
 const raw=readFileSync(new URL('./mapObstacles.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports={};new Function('require','exports',code)(name=>name==='maplibre-gl'?{Popup}:{OBSTACLE_MIN_ZOOM:11},exports);
 return {...exports,map,sources,layers,popups,queries,raw,setZoom:v=>{zoom=v;},setFeature:v=>{feature=v;}};
}
test('obstacle layer is a small circle layer, independently OFF, with no new listeners or glyph requests',()=>{
 const h=setup();h.addObstacleLayer(h.map,false);
 assert.equal(h.layers.length,1);assert.equal(h.layers[0].minzoom,11);assert.equal(h.layers[0].type,'circle');assert.equal(h.layers[0].paint['circle-radius'],5);
 assert.equal(h.layers[0].layout.visibility,'none');assert.equal(h.sources.get(h.OBSTACLE_SOURCE).type,'geojson');assert.doesNotMatch(h.raw,/\.on\(|addEventListener|fetch\(|glyphs/);
 h.setObstaclesVisible(h.map,true);assert.equal(h.layers[0].layout.visibility,'visible');
 h.setObstaclesVisible(h.map,false);assert.equal(h.layers[0].layout.visibility,'none');
});
test('touch info uses typed data and literal safe text, a 44px hitbox and close target',()=>{
 const h=setup();h.addObstacleLayer(h.map,true);
 h.setFeature({geometry:{type:'Point',coordinates:[3,50]},properties:{kind:'pylon',heightM:30,name:'<img onerror=bad>'}});
 assert.equal(h.showObstacleInfo(h.map,{x:100,y:100}),true);
 assert.deepEqual(h.queries[0].box,[[78,78],[122,122]]);assert.match(h.popups[0].text,/Pylône électrique.*30 m/);assert.match(h.popups[0].text,/<img onerror=bad>/);
 assert.equal(h.popups[0].close.style.minHeight,'44px');assert.equal(h.popups[0].element.style.color,'#0f172a');
 h.setObstaclesVisible(h.map,false);assert.equal(h.popups[0].removed,true);
});
test('unknown height is explicit; OFF and low zoom never intercept existing map clicks',()=>{
 const h=setup();h.addObstacleLayer(h.map,true);
 h.setFeature({geometry:{type:'Point',coordinates:[3,50]},properties:{kind:'wind',heightM:null,name:''}});
 assert.equal(h.showObstacleInfo(h.map,{x:0,y:0}),true);assert.match(h.popups[0].text,/Éolienne.*Hauteur inconnue/);
 h.setZoom(10);assert.equal(h.showObstacleInfo(h.map,{x:0,y:0}),false);
 h.setZoom(12);h.setObstaclesVisible(h.map,false);assert.equal(h.showObstacleInfo(h.map,{x:0,y:0}),false);assert.equal(h.queries.length,1);
});
test('overlay insertion preserves trajectories and click precedence, without adding any event listener',()=>{
 for(const path of ['../components/PreparationMap.tsx','../components/flight/FlightMap.tsx']) {
  const s=readFileSync(new URL(path,import.meta.url),'utf8');
  const insert=s.indexOf('addObstacleLayer(');assert.ok(insert>s.indexOf('addBourrousFlightZone('));
  const next=s.slice(insert);assert.match(next,/addSource\((TRACE_SOURCE|PLANNED_TRAJECTORIES_SOURCE_ID)/);
  assert.equal((s.match(/addEventListener\("online"/g)||[]).length,1);
  assert.equal((s.match(/\.on\("moveend"/g)||[]).length,1);
  assert.match(s,/showObstacleInfo\(/);
 }
 const prep=readFileSync(new URL('../components/PreparationMap.tsx',import.meta.url),'utf8');
 assert.ok(prep.indexOf('if (typeof traceId === "string")')<prep.indexOf('showObstacleInfo(map, event.point)'));
 const flight=readFileSync(new URL('../components/flight/FlightMap.tsx',import.meta.url),'utf8');
 const click=flight.slice(flight.indexOf('map.current.on("click"'));
 assert.ok(click.indexOf('showObstacleInfo(')<click.indexOf('!showAirspacesRef.current'));
});
