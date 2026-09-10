import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);

function harness(t) {
  const slots = []; let cursor = 0; let pending = [];
  const container = { clientWidth: 350, clientHeight: 160 };
  const frames = new Map(); let frameId = 0;
  globalThis.window = { requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  const observers = [];
  globalThis.ResizeObserver = class { constructor(fn) { this.notify = fn; observers.push(this); } observe() {} disconnect() {} };
  const react = { ...require("react"),
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, v => { slots[i].value = typeof v === "function" ? v(slots[i].value) : v; }]; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((d, j) => d !== old.deps[j])) { slots[i] = { deps }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    memo: (component, compare) => ({ component, compare }),
  };
  const maps = [];
  class MapMock {
    constructor() { maps.push(this); this.handlers = {}; this.sources = {}; this.removed = 0; this.fits = 0; this.resizes = 0; this.updates = 0; }
    addControl() {} on(event, fn) { this.handlers[event] = fn; }
    addSource(id, source) { this.sources[id] = { data: source.data, setData: data => { this.sources[id].data = data; this.updates++; } }; }
    getSource(id) { return this.sources[id]; } addLayer() {}
    fitBounds() { this.fits++; } resize() { this.resizes++; } remove() { this.removed++; }
  }
  let hydrated = { points: [], trackState: "UNAVAILABLE" };
  const mocks = {
    react,
    "lucide-react": { Maximize2: () => null, X: () => null },
    "maplibre-gl": { Map: MapMock, NavigationControl: class {}, LngLatBounds: class { extend() {} } },
    "maplibre-gl/dist/maplibre-gl.css": {},
    "../../lib/mapInteraction": { TWO_DIMENSIONAL_MAP_OPTIONS: {} },
    "../../hooks/useRecordedFlightJournalPoints": { useRecordedFlightJournalPointsState: () => hydrated },
  };
  const source = readFileSync(new URL("./JournalFlightMap.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(id => id in mocks ? mocks[id] : require(id), exports);
  const wrapped = exports.default;
  const flight = { id: "flight-a", origin: "REAL_GPS", departure: "A", arrival: "B", points: [] };
  const unmount = () => slots.forEach(s => s?.cleanup?.());
  t.after(() => { unmount(); delete globalThis.window; delete globalThis.document; delete globalThis.ResizeObserver; });
  const render = (value = flight) => {
    cursor = 0;
    const tree = wrapped.component({ flight: value });
    // React commits the div ref before effects.
    slots[0].current = container;
    const effects = pending; pending = []; effects.forEach(fn => fn());
    for (const [id, fn] of frames) { frames.delete(id); fn(); }
    return tree;
  };
  return { render, maps, observers, container, flight, compare: wrapped.compare, setHydrated: value => { hydrated = value; } };
}
const points = [{ latitude: 50, longitude: 3 }, { latitude: 50.1, longitude: 3.1 }];
function text(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return node?.props ? text(node.props.children) : "";
}

test("hydratation et re-renders : une seule instance, données mises à jour sans recharger les tuiles", t => {
  const h = harness(t);
  h.render();
  h.maps[0].handlers.load();
  h.setHydrated({ points, trackState: "LOCAL" });
  h.render();
  h.render({ ...h.flight, points: [], notes: "nouvelle note" });
  assert.equal(h.maps.length, 1);
  assert.equal(h.maps[0].removed, 0);
  assert.equal(h.maps[0].updates, 1);
  assert.equal(h.compare({ flight: h.flight }, { flight: { ...h.flight, points: [], notes: "note" } }), true);
  assert.equal(h.compare({ flight: h.flight }, { flight: { ...h.flight, id: "flight-b" } }), false);
});

test("pas de faux indisponible au début ni de disparition pendant une réhydratation vide", t => {
  const h = harness(t);
  assert.doesNotMatch(text(h.render()), /Trace indisponible/);
  h.maps[0].handlers.load();
  h.setHydrated({ points, trackState: "LOCAL" }); h.render(); h.render();
  const data = h.maps[0].sources["journal-flight-track"].data;
  h.setHydrated({ points: [], trackState: "LOADING_CLOUD" });
  const tree = h.render();
  assert.doesNotMatch(text(tree), /Chargement|indisponible|s’affichera/);
  assert.equal(h.maps[0].sources["journal-flight-track"].data, data);
  assert.equal(h.maps[0].removed, 0);
});

test("points reçus avant le chargement du style : la dernière trace est ajoutée", t => {
  const h = harness(t);
  h.render();
  h.setHydrated({ points, trackState: "LOCAL" }); h.render();
  h.maps[0].handlers.load();
  assert.deepEqual(h.maps[0].sources["journal-flight-track"].data.features[0].geometry.coordinates, [[3, 50], [3.1, 50.1]]);
  assert.equal(h.maps.length, 1);
});

test("resize iPhone et plein écran : aucune recréation ni recadrage en boucle", t => {
  const h = harness(t);
  h.setHydrated({ points, trackState: "LOCAL" });
  let tree = h.render(); h.maps[0].handlers.load();
  const map = h.maps[0], initialFits = map.fits, initialResizes = map.resizes;
  h.observers[0].notify(); h.observers[0].notify();
  assert.equal(map.resizes, initialResizes);
  h.container.clientHeight = 170; h.observers[0].notify();
  assert.equal(map.resizes, initialResizes + 1);
  assert.equal(map.fits, initialFits);
  tree.props.children.at(-1).props.onClick(); tree = h.render();
  tree.props.children.at(-1).props.onClick(); h.render();
  assert.equal(h.maps.length, 1); assert.equal(map.removed, 0);
});
