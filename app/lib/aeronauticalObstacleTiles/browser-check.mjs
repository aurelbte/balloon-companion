#!/usr/bin/env node
/** Optional local Safari smoke test only. Never imported into the client runtime. No remote traffic. */
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import ts from 'typescript';
import {datasets} from './runtime.fixtures.mjs';
const output='/tmp/bc-obstacle-runtime-checks';await mkdir(output,{recursive:true});
const data=await datasets(),root=resolve('.');
const allowed=new Set(['app/lib/aeronauticalObstacleTiles/index.ts','app/lib/aeronauticalObstacleTiles/runtime.ts','app/lib/aeronauticalObstacleTiles/contract.ts','app/lib/aeronauticalObstacleTiles/viewport.ts','prototypes/aeronautical-obstacles/tileGeometry.ts']);
const checks=`import {AeronauticalObstacleTileRuntime as Runtime} from '/app/lib/aeronauticalObstacleTiles/index.js';
window.runObstacleChecks=async()=>{
 if(!isSecureContext||!crypto.subtle)throw Error('WEBCRYPTO_UNAVAILABLE');
 const config=await(await fetch('/config')).json(),passed=[];
 const assert=(v,msg)=>{if(!v)throw Error(msg);};const box=e=>({west:e.bbox[0],east:e.bbox[2],south:e.bbox[1],north:e.bbox[3]});
 for(const zone of ['preuseville','le-havre','grenoble']) {
  const r=new Runtime({baseUrl:location.origin+'/data/'+zone+'/',manifestSha256:config[zone].hash}),m=await r.readManifest(),v=r.createView();
  const b={west:m.coverage.centre[0]-.8,east:m.coverage.centre[0]+.8,south:m.coverage.centre[1]-.8,north:m.coverage.centre[1]+.8};
  const low=await v.update(b,10),high=await v.update(b,12);
  assert(low.snapshot.sourceZoom===9&&high.snapshot.sourceZoom===12,'LOD');
  assert(high.snapshot.loadedObservationCount===config[zone].records,'OBSERVATIONS');assert(high.snapshot.exhaustive===false,'SAFETY');
  assert(high.snapshot.tiles.every(t=>t.status==='LOADED'||t.status==='EMPTY'),'TILES');
  if(zone==='le-havre'){const rows=new Map(high.snapshot.features.flatMap(f=>f.properties.observations.map(o=>[o.observationId,o])));const cranes=[...rows.values()].filter(o=>o.category==='crane');assert(cranes.length===13&&cranes.every(c=>c.measurements.heightAgl.valueM===null),'CRANES');}
  passed.push(zone+':SHA/GeoJSON/z9/z12/provenance');r.dispose();
 }
 for(const [mode,expected]of [['404','HTTP_404'],['410','HTTP_410'],['hash','HASH_MISMATCH'],['slow','TIMEOUT']]) {
  const r=new Runtime({baseUrl:location.origin+'/data/bad-'+mode+'/',timeoutMs:200});const m=await r.readManifest(),entry=m.tiling.tiles.find(t=>t.z===12&&t.features),out=await r.createView().update(box(entry),12);
  assert(out.snapshot.tiles[0].status===expected,'ERROR_'+mode+':'+out.snapshot.tiles[0].status);passed.push(expected);r.dispose();
 }
 const r=new Runtime({baseUrl:location.origin+'/data/rapid/',timeoutMs:2000}),m=await r.readManifest(),entries=m.tiling.tiles.filter(t=>t.z===12&&t.features),v=r.createView();
 const first=v.update(box(entries[0]),12);await new Promise(r=>setTimeout(r,30));const second=await v.update(box(entries[1]),12);assert((await first).obsolete&&second.snapshot.tiles[0].key===entries[1].key,'RACE');
 await new Promise(r=>setTimeout(r,550));assert(v.snapshot.tiles[0].key===entries[1].key,'LATE_RESPONSE');r.dispose();passed.push('rapid viewport/obsolete response');
 return{passed,secureContext:isSecureContext,userAgent:navigator.userAgent};
};`;
let server,driver,session,driverPort;
let result;
try {
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Obstacles 2B local test</title><script type="module" src="/checks.js"></script>');return;}
  if(path==='/checks.js'){res.setHeader('content-type','text/javascript');res.end(checks);return;}
  if(path==='/config'){const {createHash}=await import('node:crypto');res.setHeader('content-type','application/json');res.end(JSON.stringify(Object.fromEntries(['preuseville','le-havre','grenoble'].map(z=>[z,{hash:createHash('sha256').update(data[z].manifestBytes).digest('hex'),records:data[z].records.length}]))));return;}
  if(path.startsWith('/data/')) {
   const [, ,name,...parts]=path.split('/'),key=parts.join('/'),d=name==='rapid'?data['le-havre']:name.startsWith('bad-')?data.preuseville:data[name];
   let bytes=d?.files.get(key);if(!bytes){res.writeHead(404).end();return;}
   if(key!=='manifest.json') {
    if(name==='bad-404'||name==='bad-410'){res.writeHead(Number(name.slice(4))).end();return;}
    if(name==='bad-hash')bytes=Buffer.alloc(bytes.length,32);
    if(name==='bad-slow'||name==='rapid'&&key===d.manifest.tiling.tiles.find(t=>t.z===12&&t.features).key)await new Promise(r=>setTimeout(r,500));
   }
   res.setHeader('content-type','application/json');res.end(bytes);return;
  }
  const source=path.slice(1).replace(/\.js$/,'.ts');if(!allowed.has(source)){res.writeHead(404).end();return;}
  const js=ts.transpileModule(await readFile(resolve(root,source),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2017}}).outputText.replace(/(from\s+["'][^"']+)\.ts(["'])/g,'$1.js$2');
  res.setHeader('content-type','text/javascript');res.end(js);
 }catch{res.writeHead(500).end();}});
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
 const webPort=server.address().port;
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));driverPort=probe.address().port;await new Promise(r=>probe.close(r));
 driver=spawn('/System/Cryptexes/App/usr/bin/safaridriver',['--port',String(driverPort)],{stdio:['ignore','pipe','pipe']});let driverLog='';driver.stdout.on('data',b=>driverLog=(driverLog+b).slice(-2000));driver.stderr.on('data',b=>driverLog=(driverLog+b).slice(-2000));
 const call=async(method,path,body)=>{const r=await fetch('http://127.0.0.1:'+driverPort+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok)throw Error(j.value?.message??('WebDriver HTTP '+r.status));return j.value;};
 let started=false;for(let i=0;i<40;i++){try{await call('GET','/status');started=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!started)throw Error('SafariDriver unavailable: '+driverLog);
 const created=await call('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});session=created.sessionId;
 await call('POST','/session/'+session+'/url',{url:'http://127.0.0.1:'+webPort+'/'});
 const output=await call('POST','/session/'+session+'/execute/async',{script:'const done=arguments[arguments.length-1];(async()=>{for(let i=0;i<50&&!window.runObstacleChecks;i++)await new Promise(r=>setTimeout(r,100));return await window.runObstacleChecks();})().then(done,e=>done({error:String(e)}));',args:[]});
 result={browser:created.capabilities.browserName,version:created.capabilities.browserVersion,...output};if(output.error)process.exitCode=1;
}catch(error){result={executed:false,error:String(error)};process.exitCode=1;}
finally {
 if(session)await fetch('http://127.0.0.1:'+driverPort+'/session/'+session,{method:'DELETE'}).catch(()=>{});
 driver?.kill('SIGTERM');if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(data.root,{recursive:true,force:true});
}
await writeFile(output+'/safari.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
