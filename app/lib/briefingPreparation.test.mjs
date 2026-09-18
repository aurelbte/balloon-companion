import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {loadPreparationDraft,savePreparationDraft,PREPARATION_DRAFT_STORAGE_KEY} from './preparationDraftStorage.ts';
import {PREPARATION_SESSION_CHANGED_EVENT,startNewPreparationSession} from './preparationSession.ts';
import {DATA_SCOPE_CHANGED_EVENT,setRuntimeAuthSnapshot,setRuntimeGuestModeActive,scopedBusinessStorageKey} from './auth/dataScopeRuntime.ts';
import * as flightStorage from './flightStorage.ts';
const require=createRequire(import.meta.url);
const legacy={terrain:'LEGACY TERRAIN A',date:'2025-01-01',heure:'06:00',duree:'60 min',ballon:'LEGACY BALLOON A',meteo:'AROME'};
const draft={storageVersion:3,launchSite:{name:'MODERN TERRAIN A',latitude:48,longitude:2},departureTime:'2026-09-18T06:00:00Z',durationMinutes:60,weatherModel:'arome_seamless',balloonName:'MODERN BALLOON A',targetAltitudeAmslM:1000,createdAt:1,updatedAt:2};
function memory(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
let counter=0;
function browser(t){
 const win=new EventTarget();win.localStorage=memory();win.sessionStorage=memory();const old=Object.getOwnPropertyDescriptor(globalThis,'window');globalThis.window=win;
 const cleanups=[];t.after(()=>{cleanups.forEach(fn=>fn());if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;setRuntimeAuthSnapshot({state:'SIGNED_OUT',user:null});setRuntimeGuestModeActive(false);});
 const user='briefing-'+(++counter);
 function identity(id){setRuntimeGuestModeActive(false);setRuntimeAuthSnapshot(id?{state:'SIGNED_IN',user:{id}}:{state:'SIGNED_OUT',user:null});win.dispatchEvent(new Event(DATA_SCOPE_CHANGED_EVENT));}
 identity(user);win.localStorage.setItem('balloon_companion_flight',JSON.stringify(legacy));return {win,user,identity,cleanups};
}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join(' ');return tree&&typeof tree==='object'?text(tree.props?.children):'';}
function renderPage(e){
 let tree;let subscribed=false;
 const react={useMemo:fn=>fn(),useSyncExternalStore(subscribe,snapshot){if(!subscribed){subscribed=true;e.cleanups.push(subscribe(()=>{tree=Page();}));}return snapshot();}};
 const source=readFileSync(new URL('../briefing/page.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const componentModule={exports:{}};
 const mocks={react,'next/link':{default:'LINK'},'../lib/preparationDraftStorage':{loadPreparationDraft},'../lib/preparationSession':{PREPARATION_SESSION_CHANGED_EVENT},'../lib/auth/dataScopeRuntime':{DATA_SCOPE_CHANGED_EVENT},'../components/NavigationBar':{default:'NAV'},'../components/Button':{default:'BUTTON'}};
 new Function('require','module','exports',code)(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),componentModule,componentModule.exports);
 const Page=componentModule.exports.default;tree=Page();return {get tree(){return tree;},render(){tree=Page();return tree;}};
}
function empty(page){assert.match(text(page.tree),/Aucune préparation en cours/);assert.doesNotMatch(text(page.tree),/MODERN TERRAIN A|LEGACY TERRAIN A|LEGACY BALLOON A/);assert.ok(nodes(page.tree).some(n=>n.props?.href==='/prepare'));}
test('current authorized modern preparation produces nominal briefing, ignores different legacy',t=>{const e=browser(t);assert.equal(savePreparationDraft(draft),true);const page=renderPage(e);assert.match(text(page.tree),/MODERN TERRAIN A/);assert.match(text(page.tree),/MODERN BALLOON A/);assert.match(text(page.tree),/60 min/);assert.doesNotMatch(text(page.tree),/LEGACY TERRAIN A|LEGACY BALLOON A/);assert.equal(e.win.localStorage.getItem('balloon_companion_flight'),JSON.stringify(legacy));});
test('direct access with legacy alone has explicit empty state and prepare action',t=>{const e=browser(t);empty(renderPage(e));});
test('legacy A then logout then B never becomes B briefing',t=>{const e=browser(t);e.identity(null);e.identity(e.user+'B');empty(renderPage(e));});
for(const transition of ['logout','A-B','guest-A'])test(`opened modern briefing invalidates on ${transition}`,t=>{
 const e=browser(t);if(transition==='guest-A'){e.identity(null);setRuntimeGuestModeActive(true);startNewPreparationSession();}
 savePreparationDraft(draft);const page=renderPage(e);assert.match(text(page.tree),/MODERN TERRAIN A/);
 e.identity(transition==='logout'?null:e.user+'B');empty(page);
});
test('new preparation session immediately invalidates an opened briefing without deleting storage',t=>{const e=browser(t);savePreparationDraft(draft);const raw=e.win.sessionStorage.getItem(scopedBusinessStorageKey('USER:'+e.user,PREPARATION_DRAFT_STORAGE_KEY));const page=renderPage(e);startNewPreparationSession();empty(page);assert.equal(e.win.sessionStorage.getItem(scopedBusinessStorageKey('USER:'+e.user,PREPARATION_DRAFT_STORAGE_KEY)),raw);});
test('save notification refreshes opened briefing from existing modern loader',t=>{const e=browser(t);const page=renderPage(e);empty(page);savePreparationDraft(draft);assert.match(text(page.tree),/MODERN TERRAIN A/);savePreparationDraft({...draft,launchSite:{...draft.launchSite,name:'NEW MODERN TERRAIN'}});assert.match(text(page.tree),/NEW MODERN TERRAIN/);assert.doesNotMatch(text(page.tree),/MODERN TERRAIN A/);});
test('B own current preparation replaces A context in opened briefing',t=>{const e=browser(t);savePreparationDraft(draft);const page=renderPage(e);e.identity(e.user+'B');empty(page);savePreparationDraft({...draft,launchSite:{...draft.launchSite,name:'B OWN TERRAIN'},balloonName:'B OWN BALLOON'});assert.match(text(page.tree),/B OWN TERRAIN/);assert.doesNotMatch(text(page.tree),/MODERN TERRAIN A|MODERN BALLOON A/);});
test('malformed or un-authorized persisted modern draft is not a current preparation',t=>{const e=browser(t);const key=scopedBusinessStorageKey('USER:'+e.user,PREPARATION_DRAFT_STORAGE_KEY);e.win.sessionStorage.setItem(key,JSON.stringify(draft));empty(renderPage(e));e.win.sessionStorage.setItem(key,'{bad');e.win.dispatchEvent(new Event('storage'));assert.equal(loadPreparationDraft(),null);});
test('new JavaScript instance/reload refuses persisted draft and legacy despite prior preparation',()=>{
 const script=`import assert from 'node:assert/strict';import {loadPreparationDraft,PREPARATION_DRAFT_STORAGE_KEY} from './app/lib/preparationDraftStorage.ts';import {setRuntimeAuthSnapshot,scopedBusinessStorageKey} from './app/lib/auth/dataScopeRuntime.ts';const entries=new Map([[scopedBusinessStorageKey('USER:A',PREPARATION_DRAFT_STORAGE_KEY),${JSON.stringify(JSON.stringify(draft))}]]);globalThis.window={sessionStorage:{getItem:k=>entries.get(k)??null},localStorage:{getItem:()=>${JSON.stringify(JSON.stringify(legacy))}}};setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'A'}});assert.equal(loadPreparationDraft(),null);`;
 execFileSync(process.execPath,['--experimental-strip-types','--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','--input-type=module','--eval',script]);
});
test('only dead legacy storage helpers removed; pure migration still recognizes legacy format',()=>{for(const name of ['saveFlightPreparation','getFlightPreparation','saveCurrentFlight','getCurrentFlight','clearCurrentFlight'])assert.equal(name in flightStorage,false);const migrated=flightStorage.migrateStoredPreparation(legacy);assert.equal(migrated.unresolvedLaunchSiteName,legacy.terrain);assert.equal(migrated.launchSite,null);assert.ok(migrated.departureTime);});
