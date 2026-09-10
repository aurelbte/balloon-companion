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
  const module = { exports: {} };
  const localRequire = (id) => Object.hasOwn(mocks, id) ? mocks[id] : id.endsWith(".css") ? { default: {} } : id.startsWith(".") ? require(resolve(dirname(path), id.endsWith(".ts") ? id : `${id}.ts`)) : require(id);
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports.default;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => { const value = nodes(tree).find(predicate); assert.ok(value, "Expected rendered control"); return value; };

for (const action of ["PIC", "NON_PILOT", "LATER"]) test(`complétion ${action} : aucune navigation en échec, durée/rôle conservés, retry`, async (t) => {
  const hooks = dispatcher(); t.after(() => hooks.unmount()); browser(t);
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
  assert.deepEqual(navigations, ["/journal"]);
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
