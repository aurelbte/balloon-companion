import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import * as persistence from "./flightCompletionStorage.ts";
import { createEmptyFlightCompletionState, createDemoCompletionJournalFlight, defaultOfficialAscensionInput } from "./flightCompletion.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
const require = createRequire(import.meta.url);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function memoryStorage() {
  const data = new Map(); let fail = false;
  return { fail(value) { fail = value; }, getItem: (key) => data.get(key) ?? null, setItem(key, value) { if (fail) throw new Error("QuotaExceededError"); data.set(key, value); }, removeItem: (key) => data.delete(key), snapshot: () => [...data] };
}
function browser(t) {
  const localStorage = memoryStorage(), sessionStorage = memoryStorage();
  const win = new EventTarget();
  Object.assign(win, { localStorage, sessionStorage, location: { search: "" }, setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) });
  globalThis.window = win;
  t.after(() => { delete globalThis.window; setRuntimeGuestModeActive(false); });
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  t.after(() => previousNavigator ? Object.defineProperty(globalThis, "navigator", previousNavigator) : delete globalThis.navigator);
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  return { localStorage, sessionStorage };
}
const flightState = () => ({ ...createEmptyFlightCompletionState(), journalFlights: [{ ...createDemoCompletionJournalFlight(), id: "real", sourceFlightId: "real", logbookStatus: "CARNET_PENDING" }], officialAscensions: [] });

for (const decision of ["CARNET_PENDING", "JOURNAL_ONLY", "VALIDATE"]) test(`stockage ${decision} : échec explicite, données conservées, retry sans doublon`, (t) => {
  const { localStorage } = browser(t);
  persistence.saveFlightCompletionState(flightState());
  const before = localStorage.snapshot();
  const input = { ...defaultOfficialAscensionInput(), officialDurationMinutes: 79, observations: "Texte conservé", regulatoryRole: "PIC" };
  const save = () => decision === "VALIDATE" ? persistence.persistOfficialAscension("real", input) : persistence.persistJournalFlightDecision("real", decision);
  localStorage.fail(true);
  assert.equal(save().persisted, false);
  assert.deepEqual(localStorage.snapshot(), before);
  localStorage.fail(false);
  assert.equal(save().persisted, true);
  assert.equal(save().persisted, true);
  const saved = persistence.loadFlightCompletionState();
  if (decision === "VALIDATE") {
    assert.equal(saved.officialAscensions.length, 1);
    assert.equal(saved.officialAscensions[0].officialDurationMinutes, 79);
    assert.equal(saved.officialAscensions[0].observations, "Texte conservé");
  } else assert.equal(saved.journalFlights[0].logbookStatus, decision);
});

test("source absente : jamais de fausse confirmation ni d'écriture vide", (t) => {
  const { localStorage } = browser(t);
  const before = localStorage.snapshot();
  assert.equal(persistence.persistOfficialAscension("absent", defaultOfficialAscensionInput()).persisted, false);
  assert.equal(persistence.persistJournalFlightDecision("absent", "CARNET_PENDING").persisted, false);
  assert.deepEqual(localStorage.snapshot(), before);
});

// Real component handlers/state, deterministic rendering without browser or deps.
function dispatcher() {
  const slots = []; let cursor = 0; let effects = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const react = { ...require("react"),
    useState(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) { const cleanup = slots[index]?.cleanup; slots[index] = { deps }; effects.push(() => { cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  return { react, render(fn) { cursor = 0; const value = fn(); const pending = effects; effects = []; pending.forEach((effect) => effect()); return value; }, unmount() { slots.forEach((slot) => slot?.cleanup?.()); } };
}
function loadComponent(relative, mocks) {
  const path = resolve(dirname(new URL(import.meta.url).pathname), relative);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const componentModule = { exports: {} };
  const localRequire = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id === "../../contexts/AuthContext" ? { useBalloonAuth: () => ({ state: "SIGNED_IN" }) } : id.endsWith(".css") ? { default: {} } : id.startsWith(".") ? require(resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`)) : require(id);
  new Function("require", "module", "exports", outputText)(localRequire, componentModule, componentModule.exports);
  return componentModule.exports.default;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => { const value = nodes(tree).find(predicate); assert.ok(value, "Expected rendered control"); return value; };

for (const action of ["PIC", "NON_PILOT", "LATER"]) for (const offline of [false, true]) test(`complétion ${action} ${offline ? "offline" : "online"} : aucune navigation en échec, durée/rôle conservés, retry`, async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  navigator.onLine = !offline;
  let persisted = false; const attempts = [], navigations = [];
  const state = flightState();
  const Page = loadComponent("../flight/complete/page.tsx", {
    react: hooks.react,
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path), replace: (path) => navigations.push(path) }), useSearchParams: () => new URLSearchParams("flightId=real") },
    "../../hooks/useFlightCompletionState": { useFlightCompletionState: () => state },
    "../../lib/flightCompletionStorage": { ...persistence,
      reconcileRecordedFlightJournalProjection: async () => ({ status: "PRESENT", flight: state.journalFlights[0] }),
      persistOfficialAscension: (...args) => { attempts.push(args); return { persisted }; },
      persistJournalFlightDecision: (...args) => { attempts.push(args); return { persisted }; },
    },
  });
  const Content = Page().props.children.type;
  const render = () => hooks.render(Content);
  let tree = render(); await flush(); tree = render();
  const chosen = action === "LATER" ? "PIC" : action;
  const radio = find(tree, (node) => node.type === "input" && node.props.type === "radio" && (chosen === "PIC" ? nodes(tree).filter((n) => n.type === "input" && n.props.type === "radio").indexOf(node) === 0 : nodes(tree).filter((n) => n.type === "input" && n.props.type === "radio").indexOf(node) === 4));
  radio.props.onChange();
  find(tree, (node) => node.props?.["aria-label"] === "Augmenter la durée officielle de 1 minute").props.onClick();
  tree = render();
  const button = () => find(tree, (node) => node.type === "button" && node.props.children === (action === "LATER" ? "Plus tard" : action === "PIC" ? "Ajouter au carnet" : "Conserver uniquement dans le Journal"));
  button().props.onClick(); tree = render();
  assert.equal(navigations.length, 0);
  assert.match(find(tree, (node) => node.props?.role === "alert").props.children, /Réessayez/);
  assert.equal(nodes(tree).filter((node) => node.type === "input" && node.props.checked).length, 1);
  const first = structuredClone(attempts[0]);
  if (action === "PIC") assert.equal(first[1].officialDurationMinutes, state.journalFlights[0].durationMinutes + 1);
  persisted = true;
  button().props.onClick();
  assert.deepEqual(attempts[1], first);
  if (offline) {
    tree = render();
    assert.deepEqual(navigations, []);
    find(tree, (node) => node.props?.children === "Finalisation enregistrée localement");
    assert.equal(find(tree, (node) => node.type === "a").props.href, "/flight");
  } else assert.deepEqual(navigations, ["/journal"]);
});

test("écran ascension : propage false au formulaire, mêmes valeurs après erreur et au retry", async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = flightState(); const attempts = [], navigations = []; let persisted = false;
  const Page = loadComponent("../flight/complete/ascension/page.tsx", {
    react: hooks.react,
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path) }), useSearchParams: () => new URLSearchParams("flightId=real") },
    "../../../components/journal/OfficialAscensionForm": { default: "Form" },
    "../../../hooks/useFlightCompletionState": { useFlightCompletionState: () => state },
    "../../../lib/flightCompletionStorage": { ...persistence, loadFlightCompletionState: () => state, persistOfficialAscension: (...args) => { attempts.push(args); return { persisted }; } },
    "../../../lib/balloonStorage": { loadBalloonRegistry: () => ({ balloons: [] }) },
    "../../../lib/preparationDraftStorage": { loadPreparationDraft: () => null },
  });
  const Content = Page().props.children.type;
  const render = () => hooks.render(Content);
  render(); t.mock.timers.tick(0);
  let form = render(); const initial = form.props.initialValues;
  const input = { ...defaultOfficialAscensionInput(), officialDurationMinutes: 83, observations: "Toutes mes saisies" };
  assert.equal(form.props.onSubmit(input), false);
  form = render();
  assert.equal(navigations.length, 0);
  assert.equal(form.props.initialValues, initial);
  assert.match(form.props.submissionError, /Réessayez/);
  persisted = true;
  assert.equal(form.props.onSubmit(input), true);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(navigations, ["/journal"]);
});

test("formulaire réel : texte conservé et dirty maintenu lorsque onSubmit retourne false", async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const attempts = []; let persisted = false; let dirtyOnCancel;
  const Form = loadComponent("../components/journal/OfficialAscensionForm.tsx", {
    react: hooks.react, "next/navigation": { useRouter: () => ({}), usePathname: () => "/flight/complete/ascension" },
    "../../hooks/useBalloons": { useBalloons: () => [] },
  });
  const initialValues = { ...defaultOfficialAscensionInput(), dateIso: "2026-09-10", balloonModel: "Ballon", balloonManufacturer: "", registration: "F-TEST", departure: "Terrain", arrival: "Champ", category: "Libre à air chaud", pilotFunction: "PIC", regulatoryRole: "PIC", supervisedByFiB: false, officialDurationMinutes: 60, maximumAltitudeM: "300", flightNature: "STANDARD", takeoffCount: "1", landingCount: "1", instructorName: "", instructorLicenceNumber: "", examinerName: "", examinerLicenceNumber: "", observations: "" };
  const render = () => hooks.render(() => Form({ mode: "VALIDATE", initialValues, submissionError: persisted ? null : "Réessayez", title: "Valider", submitLabel: "Valider", backLabel: "Retour", onCancel: (dirty) => { dirtyOnCancel = dirty; }, onSubmit: (input) => { attempts.push(input); return persisted; } }));
  let tree = render(); t.mock.timers.tick(0); tree = render();
  find(tree, (node) => node.type === "textarea").props.onChange({ target: { value: "Texte à conserver" } });
  tree = render();
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await flush(); tree = render();
  assert.equal(find(tree, (node) => node.type === "textarea").props.value, "Texte à conserver");
  find(tree, (node) => node.type === "button" && nodes(node).some((child) => child.type !== "button") && node.props.children?.includes?.("Retour")).props.onClick();
  assert.equal(dirtyOnCancel, true);
  persisted = true;
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await flush();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
});

test("projection Journal non persistée à l'ouverture : erreur réessayable, aucune redirection", async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  const state = { ...flightState(), journalFlights: [] }, navigations = []; let fail = true;
  const Page = loadComponent("../flight/complete/page.tsx", {
    react: hooks.react,
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path), replace: (path) => navigations.push(path) }), useSearchParams: () => new URLSearchParams("flightId=real") },
    "../../hooks/useFlightCompletionState": { useFlightCompletionState: () => state },
    "../../lib/flightCompletionStorage": { ...persistence,
      reconcileRecordedFlightJournalProjection: async () => fail ? { status: "PERSIST_FAILED", flight: null } : { status: "RECONSTRUCTED", flight: flightState().journalFlights[0] },
    },
  });
  const Content = Page().props.children.type;
  const render = () => hooks.render(Content);
  render(); await flush(); let tree = render();
  assert.equal(navigations.length, 0);
  assert.match(find(tree, (node) => node.props?.role === "alert").props.children, /conservé/);
  fail = false;
  find(tree, (node) => node.type === "button" && node.props.children === "Réessayer").props.onClick();
  render(); await flush(); tree = render();
  assert.equal(navigations.length, 0);
  assert.ok(nodes(tree).some((node) => node.type === "button" && node.props.children === "Ajouter au carnet"));
});

test("finalisation après rechargement invité : choix explicite puis vol local accessible", async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  setRuntimeGuestModeActive(false);
  let activations = 0;
  const auth = { state: "SIGNED_OUT", authChoiceState: "AUTH_CHOICE_PENDING", activateGuestMode() { activations++; auth.authChoiceState = "GUEST_ACTIVE"; setRuntimeGuestModeActive(true); } };
  const state = flightState(), navigations = [];
  const Page = loadComponent("../flight/complete/page.tsx", {
    react: hooks.react,
    "../../contexts/AuthContext": { useBalloonAuth: () => auth },
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path), replace: (path) => navigations.push(path) }), useSearchParams: () => new URLSearchParams("flightId=real") },
    "../../hooks/useFlightCompletionState": { useFlightCompletionState: () => auth.authChoiceState === "GUEST_ACTIVE" ? state : { ...state, journalFlights: [] } },
    "../../lib/flightCompletionStorage": { ...persistence, reconcileRecordedFlightJournalProjection: async () => ({ status: "SCOPE_UNAVAILABLE", flight: null }) },
  });
  const Content = Page().props.children.type;
  const render = () => hooks.render(Content);
  let tree = render(); await flush(); tree = render();
  assert.equal(activations, 0);
  find(tree, (node) => node.type === "button" && node.props.children === "Continuer en mode invité").props.onClick();
  tree = render();
  assert.equal(activations, 1);
  assert.equal(nodes(tree).some((node) => node.props?.children === "Vol enregistré"), true);
  assert.deepEqual(navigations, []);
});

for (const mode of ['CREATE', 'UPDATE']) test(`B8 ${mode}: quota visible, retry, no success before persistence, synchronous duplicate blocked`, (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount());
  const { localStorage, sessionStorage } = browser(t);
  const initial = persistence.persistManualOfficialAscension({ ...defaultOfficialAscensionInput(), observations: 'OLD' });
  const id = initial.officialAscensions[0].id, navigations = [];
  const Page = loadComponent(mode === 'CREATE' ? '../journal/ascension/new/page.tsx' : '../journal/ascension/[id]/edit/page.tsx', {
    react: hooks.react,
    'next/navigation': { useRouter: () => ({ push: path => navigations.push(path) }), useParams: () => ({ id }) },
    '../../../../hooks/useFlightCompletionState': { useFlightCompletionState: () => persistence.loadFlightCompletionState() },
    '../../../components/journal/OfficialAscensionForm': { default: 'FORM' },
    '../../../../components/journal/OfficialAscensionForm': { default: 'FORM' },
  });
  const input = { ...defaultOfficialAscensionInput(), observations: 'NEW' };
  localStorage.fail(true);
  let tree = hooks.render(Page);
  assert.equal(tree.props.onSubmit(input), false);
  tree = hooks.render(Page);
  assert.match(tree.props.submissionError, /Impossible.*Réessayez/);
  assert.equal(navigations.length, 0);
  assert.equal(sessionStorage.getItem('balloon-companion-ascension-added'), null);
  assert.equal(persistence.loadFlightCompletionState().officialAscensions[0].observations, 'OLD');
  localStorage.fail(false);
  assert.equal(tree.props.onSubmit(input), true);
  assert.equal(tree.props.onSubmit(input), false);
  assert.equal(navigations.length, 1);
  const saved = persistence.loadFlightCompletionState().officialAscensions;
  assert.equal(saved.length, mode === 'CREATE' ? 2 : 1);
  assert.equal(saved.at(-1).observations, 'NEW');
  assert.equal(hooks.render(Page).props.submissionError, null);
});

test('B8 UPDATE: null is visible and retry stays possible', t => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  let result = null; const navigations = [];
  const Page = loadComponent('../journal/ascension/[id]/edit/page.tsx', {
    react: hooks.react,
    'next/navigation': { useRouter: () => ({ push: x => navigations.push(x) }), useParams: () => ({id:'a'}) },
    '../../../../hooks/useFlightCompletionState': { useFlightCompletionState: () => ({officialAscensions:[{id:'a', departure:'A', arrival:'B'}]}) },
    '../../../../lib/officialAscensionEditing': { officialAscensionToEditValues: x => x },
    '../../../../lib/flightCompletionStorage': { persistOfficialAscensionUpdate: () => result },
    '../../../../components/journal/OfficialAscensionForm': {default:'FORM'},
  });
  assert.equal(hooks.render(Page).props.onSubmit(defaultOfficialAscensionInput()), false);
  assert.match(hooks.render(Page).props.submissionError, /Impossible de modifier/);
  assert.equal(navigations.length, 0);
  result = {id:'a'};
  assert.equal(hooks.render(Page).props.onSubmit(defaultOfficialAscensionInput()), true);
  assert.equal(navigations.length, 1);
});

for (const failure of ['false','throw']) test(`B8 DELETE ${failure}: dialog retains ascension, visible error, retry succeeds`, t => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
  let state = persistence.persistManualOfficialAscension(defaultOfficialAscensionInput()), fail = true;
  const Log = loadComponent('../components/journal/AscensionLog.tsx', {
    react: hooks.react,
    '../../hooks/useFlightCompletionState': {useFlightCompletionState: () => state},
    './DeleteFlightDialog': {default:'DIALOG'},
    '../../hooks/useJournalCardSwipe': {useJournalCardSwipe: () => ({})},
    '../../lib/flightCompletionStorage': {saveFlightCompletionState(next) {if (fail) {if (failure === 'throw') throw Error('storage'); return false;} state=next; return true;}},
  });
  let tree = hooks.render(Log);
  find(tree, n => typeof n.props?.onDelete === 'function').props.onDelete();
  tree = hooks.render(Log); find(tree, n => n.type === 'DIALOG').props.onConfirm();
  tree = hooks.render(Log);
  const dialog = find(tree, n => n.type === 'DIALOG');
  assert.match(dialog.props.error, /Impossible de supprimer/);
  assert.equal(state.officialAscensions.length, 1);
  fail=false; dialog.props.onConfirm(); tree=hooks.render(Log);
  assert.equal(state.officialAscensions.length, 0);
  assert.equal(nodes(tree).some(n => n.type === 'DIALOG'), false);
});

test('B8 delete dialog renders its error inside the modal', t => {
  const hooks=dispatcher(); t.after(() => hooks.unmount());
  const Dialog=loadComponent('../components/journal/DeleteFlightDialog.tsx', {react:hooks.react});
  const tree=hooks.render(() => Dialog({flightName:'Test', entityLabel:'ascension', error:'Impossible de supprimer l’ascension. Réessayez.', onCancel(){}, onConfirm(){}}));
  assert.match(find(tree,n => n.props?.role === 'alert').props.children,/Impossible de supprimer/);
});

for (const mode of ['CREATE','UPDATE']) test(`B8 ${mode}: actual form retains edits and dirty after page storage exception`, async t => {
  const pageHooks=dispatcher(), formHooks=dispatcher(); t.after(() => {pageHooks.unmount(); formHooks.unmount();});
  const {localStorage}=browser(t); t.mock.timers.enable({apis:['setTimeout']});
  const initial=persistence.persistManualOfficialAscension({...defaultOfficialAscensionInput(), observations:'OLD'}), id=initial.officialAscensions[0].id;
  const Page=loadComponent(mode === 'CREATE' ? '../journal/ascension/new/page.tsx' : '../journal/ascension/[id]/edit/page.tsx', {
    react:pageHooks.react, 'next/navigation':{useRouter:()=>({push(){assert.fail('no navigation after failure')}}),useParams:()=>({id})},
    '../../../../hooks/useFlightCompletionState':{useFlightCompletionState:()=>initial},
    '../../../components/journal/OfficialAscensionForm':{default:'FORM'}, '../../../../components/journal/OfficialAscensionForm':{default:'FORM'},
  });
  const Form=loadComponent('../components/journal/OfficialAscensionForm.tsx', {react:formHooks.react, 'next/navigation':{useRouter:()=>({push(){}}),usePathname:()=>'/journal/ascension'}, '../../hooks/useBalloons':{useBalloons:()=>[]}});
  const initialValues={...defaultOfficialAscensionInput(),dateIso:'2026-09-10',balloonModel:'Ballon',balloonManufacturer:'',registration:'F-TEST',departure:'Terrain',arrival:'Champ',category:'Libre à air chaud',pilotFunction:'PIC',regulatoryRole:'PIC',supervisedByFiB:false,officialDurationMinutes:60,maximumAltitudeM:'300',flightNature:'STANDARD',takeoffCount:'1',landingCount:'1',instructorName:'',instructorLicenceNumber:'',examinerName:'',examinerLicenceNumber:'',observations:''};
  let dirty;
  const render=()=>formHooks.render(()=>Form({...pageHooks.render(Page).props, initialValues,onCancel:value=>{dirty=value}}));
  let tree=render();t.mock.timers.tick(0);tree=render();
  find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Texte à conserver'}});tree=render();localStorage.fail(true);
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();tree=render();
  assert.equal(find(tree,n=>n.type==='textarea').props.value,'Texte à conserver');
  assert.match(find(tree,n=>n.props?.role==='alert').props.children,/Impossible/);
  find(tree,n=>n.type==='button' && n.props.children==='Annuler').props.onClick();assert.equal(dirty,true);
});

test('B8 C2: failed CREATE/UPDATE/DELETE persist no new intent and never open the outbox', async t => {
  const {localStorage}=browser(t);
  const original=persistence.persistManualOfficialAscension(defaultOfficialAscensionInput()), id=original.officialAscensions[0].id;
  const {scopedBusinessStorageKey}=await import('./auth/dataScopeRuntime.ts');
  const {removeOfficialAscension}=await import('./flightCompletion.ts');
  setRuntimeAuthSnapshot({state:'SIGNED_IN',user:{id:'B8'}});
  localStorage.setItem(scopedBusinessStorageKey('USER:B8',persistence.FLIGHT_COMPLETION_STORAGE_KEY),JSON.stringify(original));
  const before=localStorage.snapshot();let opens=0;
  const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){opens++;throw Error('unexpected enqueue')}}});
  t.after(()=>previous?Object.defineProperty(globalThis,'indexedDB',previous):delete globalThis.indexedDB);
  localStorage.fail(true);
  assert.throws(()=>persistence.persistManualOfficialAscension(defaultOfficialAscensionInput()),/Enregistrement local/);
  assert.throws(()=>persistence.persistOfficialAscensionUpdate(id,defaultOfficialAscensionInput()),/Enregistrement local/);
  assert.equal(persistence.saveFlightCompletionState(removeOfficialAscension(original,id)),false);
  await flush();assert.equal(opens,0);assert.deepEqual(localStorage.snapshot(),before);
});

for (const mode of ['CREATE', 'UPDATE']) for (const scenario of ['session', 'navigation', 'both']) test(`B8 post-save ${mode} ${scenario}: one write, safe navigation retry`, t => {
  const hooks=dispatcher();t.after(()=>hooks.unmount());
  const {sessionStorage}=browser(t);
  const initial=persistence.persistManualOfficialAscension(defaultOfficialAscensionInput()), id=initial.officialAscensions[0].id;
  let writes=0, navFails=scenario!=='session'; const attempts=[];
  sessionStorage.fail(scenario!=='navigation');
  const wrapped={...persistence,
    persistManualOfficialAscension(input){writes++;return persistence.persistManualOfficialAscension(input);},
    persistOfficialAscensionUpdate(...args){writes++;return persistence.persistOfficialAscensionUpdate(...args);},
  };
  const Page=loadComponent(mode==='CREATE'?'../journal/ascension/new/page.tsx':'../journal/ascension/[id]/edit/page.tsx',{
    react:hooks.react,
    'next/navigation':{useRouter:()=>({push(path){attempts.push(path);if(navFails)throw Error('navigation failed');}}),useParams:()=>({id})},
    '../../../../hooks/useFlightCompletionState':{useFlightCompletionState:()=>persistence.loadFlightCompletionState()},
    '../../../lib/flightCompletionStorage':wrapped,'../../../../lib/flightCompletionStorage':wrapped,
    '../../../components/journal/OfficialAscensionForm':{default:'FORM'},'../../../../components/journal/OfficialAscensionForm':{default:'FORM'},
  });
  const handler=hooks.render(Page).props.onSubmit;
  assert.equal(handler({...defaultOfficialAscensionInput(),observations:'SAVED'}),true);
  assert.equal(handler(defaultOfficialAscensionInput()),false);
  assert.equal(writes,1);assert.equal(attempts.length,1);
  assert.equal(persistence.loadFlightCompletionState().officialAscensions.length,mode==='CREATE'?2:1);
  if(navFails){
    let tree=hooks.render(Page);
    assert.match(find(tree,n=>n.props?.role==='alert').props.children,/bien enregistrée/);
    assert.equal(nodes(tree).some(n=>n.type==='FORM'),false);
    find(tree,n=>n.type==='button').props.onClick();
    assert.equal(writes,1);assert.equal(attempts.length,2);
    tree=hooks.render(Page);assert.match(find(tree,n=>n.props?.role==='alert').props.children,/bien enregistrée/);
    navFails=false;find(tree,n=>n.type==='button').props.onClick();
    assert.equal(writes,1);assert.equal(attempts.length,3);
  }else assert.equal(hooks.render(Page).props.submissionError,null);
});

for(const mode of ['CREATE','UPDATE']) test(`B8 ${mode} synchronous reentrant submit blocked during persistence`,t=>{
  const hooks=dispatcher();t.after(()=>hooks.unmount());browser(t);
  let handler,writes=0,nested;
  const wrapped={persistManualOfficialAscension(){writes++;nested=handler(defaultOfficialAscensionInput());return {};},persistOfficialAscensionUpdate(){writes++;nested=handler(defaultOfficialAscensionInput());return {id:'a'};}};
  const Page=loadComponent(mode==='CREATE'?'../journal/ascension/new/page.tsx':'../journal/ascension/[id]/edit/page.tsx',{
    react:hooks.react,'next/navigation':{useRouter:()=>({push(){}}),useParams:()=>({id:'a'})},
    '../../../../hooks/useFlightCompletionState':{useFlightCompletionState:()=>({officialAscensions:[{id:'a',departure:'A',arrival:'B'}]})},
    '../../../../lib/officialAscensionEditing':{officialAscensionToEditValues:x=>x},
    '../../../lib/flightCompletionStorage':wrapped,'../../../../lib/flightCompletionStorage':wrapped,
    '../../../components/journal/OfficialAscensionForm':{default:'FORM'},'../../../../components/journal/OfficialAscensionForm':{default:'FORM'},
  });
  handler=hooks.render(Page).props.onSubmit;assert.equal(handler(defaultOfficialAscensionInput()),true);assert.equal(nested,false);assert.equal(writes,1);
});
