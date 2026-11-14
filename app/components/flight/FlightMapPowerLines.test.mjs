import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { readFile as readBytes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PreparationPowerLineRuntime, LFQOPowerLineTiles, francePowerLineSource, belgiumPowerLineSource, preparationPowerLineStatusLabel } from '../../lib/preparationPowerLines.ts';
import { FlightPowerLineRuntime } from '../../lib/flightPowerLines.ts';
import { PowerLineMemoryStore } from '../../lib/powerLinesRuntime.ts';
import { obstacleQueryBounds } from '../../lib/obstacles.ts';
const source = readFileSync(new URL('./FlightMap.tsx',import.meta.url),'utf8');
const compile = text => ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const start = source.indexOf('  useEffect(() => {\n    const runtime = new FlightPowerLineRuntime(');
assert.ok(start >= 0);
const end = source.indexOf('  }, []);',start)+'  }, []);'.length;
const effect = new Function('useEffect','FlightPowerLineRuntime','map','setPowerLineState','setObstacleState','powerLineRuntimeRef','window','navigator','showPowerLinesRef','showObstaclesRef','POWER_LINES_SOURCE_ID','OBSTACLE_SOURCE','OBSTACLE_MIN_ZOOM',compile(source.slice(start,end)));
const fetchStart = source.indexOf('  const fetchPowerLinesForViewport = async () => {');
const fetchEnd = source.indexOf('\n  };',fetchStart)+'\n  };'.length;
const makeRefresh = new Function('map','showPowerLinesRef','showObstaclesRef','powerLineRuntimeRef','navigator','OBSTACLE_MIN_ZOOM',compile(source.slice(fetchStart,fetchEnd))+'; return fetchPowerLinesForViewport;');
const paris={west:2.34,east:2.35,south:48.85,north:48.86},brussels={west:4.34,east:4.35,south:50.84,north:50.85};
const lfqo={west:3.07,east:3.08,south:50.68,north:50.69},outside={west:-3.75,east:-3.65,south:40.4,north:40.5};
function harness({countries=true,failed=false,gate}={}) {
 let view=paris,zoom=12,cleanup,layerReady=true,moduleLoads=0;
 const lines=[],obstacles=[],states=[],requests=[],local=[],api=[],events=new Map();
 const enabled={current:false},obs={current:false},navigator={onLine:true},runtimeRef={current:null};
 const map={current:{getZoom:()=>zoom,getBounds:()=>({getWest:()=>view.west,getSouth:()=>view.south,getEast:()=>view.east,getNorth:()=>view.north}),
  getLayer:()=>layerReady,setLayoutProperty(){},getSource:id=>({setData:data=>(id==='electric'?lines:obstacles).push(data)})}};
 const catalog=(config,name)=>{
  const bodies=new Map();
  const tiles=config.manifest.tiling.tiles.map(t=>{
   const features=t.features?[{type:'Feature',id:'way/42',properties:{power:'line',voltage:'20000;63000',voltage_max_v:63000,location:'overhead',source:name},geometry:{type:'LineString',coordinates:[[2.34,48.85],[2.35,48.86]]}}]:[];
   const body=JSON.stringify({type:'FeatureCollection',features});bodies.set(t.key,body);
   return {...t,features:features.length,sha256:createHash('sha256').update(body).digest('hex')};
  });
  return new LFQOPowerLineTiles(async(url,options)=>{
   requests.push({name,url,cache:options.cache}); if(gate)await gate;
   return failed?new Response(null,{status:503}):new Response(bodies.get(url.slice(config.base.length)));
  },{...config,manifest:{...config.manifest,tiling:{...config.manifest.tiling,tiles}}});
 };
 const fr=catalog(francePowerLineSource,'France'),be=catalog(belgiumPowerLineSource,'Belgique');
 const localTiles=new LFQOPowerLineTiles(async url=>{local.push(url);return new Response(await readBytes(new URL('../../../public'+url,import.meta.url)));});
 const store=new PowerLineMemoryStore(async url=>{
  api.push(url);const p=new URL(url,'https://test.invalid').searchParams;
  assert.equal(p.get('lines'),'0','Flight must not request unverified electric Overpass data');
  const b=Object.fromEntries(['west','south','east','north'].map(k=>[k,Number(p.get(k))]));
  return Response.json({obstacles:{type:'FeatureCollection',features:[],bounds:obstacleQueryBounds(b),fetchedAt:new Date().toISOString(),complete:true,rejectedElements:0,emptyConfirmed:true}});
 });
 class InjectedReader extends PreparationPowerLineRuntime {
  constructor(publish,_store,publishObstacles,_local,_be,_fr,options) {
   super(publish,store,publishObstacles,localTiles,countries?be:null,countries?fr:null,options);
  }
 }
 class InjectedRuntime extends FlightPowerLineRuntime {
  constructor(publish,publishObstacles) {
   super(publish,publishObstacles,{store,load:async()=>{moduleLoads++;return {PreparationPowerLineRuntime:InjectedReader};}});
  }
 }
 effect(fn=>{cleanup=fn();},InjectedRuntime,map,state=>states.push(state),()=>{},runtimeRef,
  {addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}},navigator,enabled,obs,'electric','obstacles',11);
 const refresh=makeRefresh(map,enabled,obs,runtimeRef,navigator,11);
 return {map,states,lines,requests,local,api,events,enabled,obs,navigator,runtimeRef,refresh,layerReady:value=>{layerReady=value;},
  view:value=>{view=value;},zoom:value=>{zoom=value;},dispose:()=>cleanup(),get state(){return states.at(-1);},get moduleLoads(){return moduleLoads;}};
}

test('actual FlightMap wiring loads France/Belgium by viewport only when enabled; cached tiles feed MapLibre without LFQO duplicates',async t=>{
 const h=harness();t.after(h.dispose);
 await h.refresh();assert.equal(h.requests.length,0);assert.equal(h.api.length,0);assert.equal(h.moduleLoads,0);
 h.enabled.current=true;
 for(const [view,name] of [[paris,'France'],[brussels,'Belgique'],[lfqo,'France']]) {
  h.view(view);const before=h.requests.length;
  await Promise.all([h.refresh(),h.refresh()]);
  assert.ok(h.requests.length>before);assert.ok(h.requests.slice(before).every(r=>r.name===name));
  assert.equal(h.lines.at(-1),h.state.data);assert.equal(h.state.covered,true);
  assert.ok(h.state.data.features.length>0);assert.equal(new Set(h.state.data.features.map(f=>f.id)).size,h.state.data.features.length);
  assert.ok(h.state.data.features.every(f=>f.properties.power==='line'&&f.properties.voltage_max_v>=63000));
 }
 assert.equal(h.local.length,0);assert.equal(h.api.length,0);assert.equal(h.moduleLoads,1);
 assert.equal(new Set(h.requests.map(r=>r.url)).size,h.requests.length);
 const count=h.requests.length;await h.refresh();assert.equal(h.requests.length,count);
 h.view(outside);await h.refresh();assert.equal(h.api.length,0);assert.equal(h.state.covered,false);
 assert.equal(h.state.data.features.length,0);assert.match(preparationPowerLineStatusLabel(h.state),/Hors couverture.*non disponibles/);
});
test('flight obstacles and online/offline refresh do not activate electric tiles when the line filter is off',async t=>{
 const h=harness();t.after(h.dispose);h.obs.current=true;
 await h.refresh();assert.equal(h.requests.length,0);assert.equal(h.api.length,1);assert.equal(h.moduleLoads,0);
 h.events.get('online')();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,0);
 h.zoom(10);await h.refresh();assert.equal(h.api.length,1);
 h.zoom(12);h.enabled.current=true;await h.refresh();assert.equal(h.state.status,'AVAILABLE');
 const count=h.requests.length;h.navigator.onLine=false;h.events.get('offline')();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.state.offline,true);assert.equal(h.requests.length,count);
});
test('flight failures and partial extraction coverage remain unknown/incomplete; LFQO-only tiles still work without Overpass',async t=>{
 const failed=harness({failed:true});t.after(failed.dispose);failed.enabled.current=true;await failed.refresh();
 assert.equal(failed.state.status,'UNAVAILABLE');assert.equal(failed.state.covered,false);assert.equal(failed.api.length,0);
 assert.match(preparationPowerLineStatusLabel(failed.state),/HTTP 503/);
 const edge=harness();t.after(edge.dispose);edge.enabled.current=true;edge.view({west:-7,east:-4,south:47,north:49});await edge.refresh();
 assert.equal(edge.state.covered,false);assert.match(preparationPowerLineStatusLabel(edge.state),/couverture partielle/);assert.equal(edge.api.length,0);
 const local=harness({countries:false});t.after(local.dispose);local.enabled.current=true;local.view(lfqo);await local.refresh();
 assert.equal(local.state.status,'AVAILABLE');assert.ok(local.local.length>0);assert.equal(local.requests.length,0);assert.equal(local.api.length,0);
});
test('deactivation and unmount suppress queued country requests and late MapLibre callbacks',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const h=harness({gate});h.enabled.current=true;
 const pending=h.refresh();await new Promise(resolve=>setImmediate(resolve));assert.ok(h.requests.length>0);
 const start=source.indexOf('  useEffect(() => {\n    showPowerLinesRef.current = showPowerLines;');
 const end=source.indexOf('  }, [showPowerLines]);',start)+'  }, [showPowerLines]);'.length;
 const toggle=new Function('useEffect','showPowerLinesRef','showPowerLines','map','POWER_LINES_LAYER_ID','POWER_LINES_CASING_LAYER_ID','powerLineRuntimeRef','showObstaclesRef','fetchPowerLinesForViewport',compile(source.slice(start,end)));
 // Cancel even while style/layers are temporarily unavailable, without cancelling the obstacle layer.
 h.layerReady(false);h.obs.current=true;
 toggle(fn=>fn(),h.enabled,false,h.map,'line','casing',h.runtimeRef,h.obs,h.refresh);
 const count=h.lines.length;release();await pending;assert.equal(h.lines.length,count);
 h.dispose();assert.equal(h.events.size,0);assert.equal(h.runtimeRef.current,null);
});
test('actual FlightMap status JSX keeps unloaded/partial/offline warnings visible during an active flight',()=>{
 const ast=ts.createSourceFile('FlightMap.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression;const visit=node=>{if(ts.isJsxExpression(node)&&node.expression?.getText(ast).startsWith('showPowerLines && powerLineState &&'))expression=node.expression.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(expression);
 const render=new Function('showPowerLines','showPowerLineStatus','powerLineState','preparationPowerLineStatusLabel','React',compile(`function render(){return (${expression});}`)+';return render();');
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const base={status:'AVAILABLE',covered:true,loading:false,offline:false,data:{type:'FeatureCollection',features:[]},coverageLabel:'France R2 · non exhaustif',localCoverage:'FULL'};
 assert.equal(render(true,false,base,preparationPowerLineStatusLabel,React),false);
 for(const change of [{covered:false,status:'UNAVAILABLE'},{covered:false,localCoverage:'PARTIAL'},{loading:true,covered:false},{offline:true}]) {
  const state={...base,...change};const badge=render(true,false,state,preparationPowerLineStatusLabel,React);
  assert.equal(badge.props.role,'status');assert.equal(badge.children[0],preparationPowerLineStatusLabel(state));
 }
 assert.equal(render(false,true,{...base,covered:false},preparationPowerLineStatusLabel,React),false);
});
test('FlightMap preserves the red line, dark casing and ordering of the existing renderer',()=>{
 const begin=source.indexOf('      const powerLineLayout = {'),end=source.indexOf('      addObstacleLayer(',begin);
 assert.ok(begin>=0&&end>begin);const layers=[];
 const run=new Function('map','showPowerLinesRef','POWER_LINES_CASING_LAYER_ID','POWER_LINES_LAYER_ID','POWER_LINES_SOURCE_ID','FLIGHT_POWER_LINE_MIN_ZOOM',compile(source.slice(begin,end)));
 run({current:{getLayer:()=>false,addLayer:layer=>layers.push(layer)}},{current:true},'casing','line','electric',8);
 assert.deepEqual(layers.map(l=>l.id),['casing','line']);assert.equal(layers[0].paint['line-color'],'rgba(7, 17, 31, 0.82)');assert.equal(layers[1].paint['line-color'],'#dc2626');
 assert.ok(layers.every(l=>l.layout.visibility==='visible'&&l.source==='electric'&&l.minzoom===8));
});


test('flight low zoom never loads country indexes or invisible tiles and explicitly warns about unloaded coverage',async t=>{
 const h=harness();t.after(h.dispose);h.enabled.current=true;h.zoom(7);
 await h.refresh();assert.equal(h.moduleLoads,0);assert.equal(h.requests.length,0);assert.equal(h.api.length,0);
 assert.equal(h.state.covered,false);assert.equal(h.state.status,'UNKNOWN_COVERAGE');
 assert.match(preparationPowerLineStatusLabel(h.state),/non chargées à ce zoom/);
 h.zoom(12);await h.refresh();assert.equal(h.moduleLoads,1);assert.equal(h.state.status,'AVAILABLE');
});
