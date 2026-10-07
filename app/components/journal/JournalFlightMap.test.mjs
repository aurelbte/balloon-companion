import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as airspaceStyle from "../../lib/airspaceMapStyle.ts";
const require = createRequire(import.meta.url);

function harness(t, satelliteKey = "test-key") {
  const oldKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  process.env.NEXT_PUBLIC_MAPTILER_KEY = satelliteKey;
  t.after(() => { if (oldKey === undefined) delete process.env.NEXT_PUBLIC_MAPTILER_KEY; else process.env.NEXT_PUBLIC_MAPTILER_KEY = oldKey; });
  const slots = []; let cursor = 0; let pending = [];
  const container = { clientWidth: 350, clientHeight: 160 };
  const frames = new Map(); let frameId = 0;
  const networkListeners = new Map();
  globalThis.window = { addEventListener: (e, fn) => networkListeners.set(e, fn), removeEventListener: e => networkListeners.delete(e), requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
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
    constructor(options) {
      maps.push(this); this.handlers = {}; this.listeners = {}; this.sources = {}; this.layers = new Map(options.style.layers.map(layer => [layer.id, layer]));
      this.removed = 0; this.fits = 0; this.resizes = 0; this.updates = 0;
    }
    addControl() {}
    on(event, fn) {
      (this.listeners[event] ??= []).push({ fn, once: false });
      this.handlers[event] = () => this.emit(event);
    }
    once(event, fn) { (this.listeners[event] ??= []).push({ fn, once: true }); }
    off(event, fn) { this.listeners[event] = (this.listeners[event] ?? []).filter(item => item.fn !== fn); }
    emit(event) { for (const item of [...(this.listeners[event] ?? [])]) { if (item.once) this.off(event, item.fn); item.fn(); } }
    loaded() { return false; } // Even after load, tiles/sources may be busy.
    getCenter() { return { lat: 50, lng: 3 }; }
    getBounds() { return { getWest: () => 2.9, getEast: () => 3.2, getSouth: () => 49.9, getNorth: () => 50.2 }; }
    addSource(id, source) { this.sources[id] = { ...source, setData: data => { this.sources[id].data = data; if (id === "journal-flight-track") this.updates++; } }; }
    getSource(id) { return this.sources[id]; }
    addLayer(layer) { this.layers.set(layer.id, layer); }
    getLayer(id) { return this.layers.get(id); }
    setLayoutProperty(id, property, value) { const layer = this.layers.get(id); assert.ok(layer, id); (layer.layout ??= {})[property] = value; }
    fitBounds() { this.fits++; } resize() { this.resizes++; } remove() { this.removed++; }
  }
  let hydrated = { points: [], trackState: "UNAVAILABLE" };
  let coverage = { airspaces: { type: "FeatureCollection", features: [] }, statusMessage: null };
  let coverageInput;
  const runtimes = [];
  class RuntimeMock {
    constructor(publish) { this.publish = publish; this.requests = []; this.stops = 0; runtimes.push(this); }
    update(bounds, online) { this.requests.push({ bounds, online }); }
    stop() { this.stops++; }
  }
  const mocks = {
    react,
    "../../hooks/useAirspaceCoverage": { useAirspaceCoverage: input => { coverageInput = input; return coverage; } },
    "../../lib/airspaceMapStyle": airspaceStyle,
    "../../lib/powerLinesRuntime": { PowerLineRuntime: RuntimeMock, powerLineStatusLabel: () => "" },
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
  return { render, maps, observers, container, flight, runtimes, networkListeners, coverageInput: () => coverageInput, setCoverage: data => { coverage = { ...coverage, airspaces: data }; }, compare: wrapped.compare, setHydrated: value => { hydrated = value; } };
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

function findButton(node, label) {
  if (Array.isArray(node)) return node.map(child => findButton(child, label)).find(Boolean);
  if (!node?.props) return undefined;
  if (node.type === "button" && (node.props["aria-label"] === label || text(node) === label)) return node;
  return findButton(node.props.children, label);
}
const openMap = tree => findButton(tree, "Ouvrir la carte plein écran").props.onClick();
const visibility = (map, id) => map.getLayer(id).layout?.visibility;

test("couches OFF, commandes plein écran, ordre et bascules sans toucher à la trace ni au cadrage", t => {
  const h = harness(t);
  h.setHydrated({ points, trackState: "LOCAL" });
  let tree = h.render(); const map = h.maps[0]; map.handlers.load();
  assert.equal(findButton(tree, "Satellite"), undefined);
  assert.equal(visibility(map, "journal-satellite"), "none");
  assert.equal(h.runtimes.length, 0);
  openMap(tree); tree = h.render();
  for (const label of ["Satellite", "Espaces aériens", "Lignes électriques"]) assert.equal(findButton(tree, label).props["aria-pressed"], false);
  const fits = map.fits, updates = map.updates, trace = map.sources["journal-flight-track"].data;
  for (const label of ["Satellite", "Espaces aériens", "Lignes électriques"]) { findButton(tree, label).props.onClick(); tree = h.render(); }
  assert.equal(map.loaded(), false);
  assert.equal(visibility(map, "journal-satellite"), "visible");
  assert.equal(visibility(map, "journal-plan"), "none");
  const airspaceIds = [...map.layers.keys()].filter(id => id.startsWith("journal-airspace-"));
  for (const id of airspaceIds) assert.equal(visibility(map, id), "visible");
  assert.equal(visibility(map, "journal-power-line"), "visible");
  const ids = [...map.layers.keys()];
  assert.ok(ids.indexOf("journal-satellite") < ids.indexOf(airspaceIds[0]));
  assert.ok(ids.indexOf(airspaceIds.at(-1)) < ids.indexOf("journal-power-casing"));
  assert.ok(ids.indexOf("journal-power-line") < ids.indexOf("journal-track-halo"));
  assert.equal(map.fits, fits); assert.equal(map.updates, updates); assert.equal(map.sources["journal-flight-track"].data, trace);
  assert.equal(h.coverageInput().position, null); assert.equal(h.coverageInput().explorationEnabled, true);
  const runtime = h.runtimes[0]; assert.equal(runtime.requests.length, 1);
  const powerData = { type: "FeatureCollection", features: [] };
  runtime.publish({ data: powerData });
  assert.equal(map.sources["journal-power-lines"].data, powerData);
  map.emit("moveend"); assert.equal(runtime.requests.length, 2);
  h.networkListeners.get("online")(); assert.equal(runtime.requests.length, 3);
  for (const label of ["Satellite", "Espaces aériens", "Lignes électriques"]) { findButton(tree, label).props.onClick(); tree = h.render(); }
  assert.equal(visibility(map, "journal-plan"), "visible");
  assert.equal(visibility(map, "journal-power-line"), "none");
  assert.equal(runtime.stops, 1); assert.equal(h.networkListeners.size, 0);
  assert.equal(map.fits, fits); assert.equal(map.updates, updates);
  findButton(tree, "Lignes électriques").props.onClick(); tree = h.render();
  findButton(tree, "Fermer la carte plein écran").props.onClick(); tree = h.render();
  assert.equal(findButton(tree, "Lignes électriques"), undefined);
  assert.equal(visibility(map, "journal-power-line"), "none");
  assert.equal(h.runtimes[1].stops, 1);
  assert.equal(h.maps.length, 1); assert.equal(map.removed, 0);
});

test("options avant load puis données après load avec loaded() faux : synchronisation immédiate", t => {
  const h = harness(t);
  let tree = h.render(); openMap(tree); tree = h.render();
  for (const label of ["Satellite", "Espaces aériens", "Lignes électriques"]) { findButton(tree, label).props.onClick(); tree = h.render(); }
  const before = { type: "FeatureCollection", features: [] };
  h.setCoverage(before); h.render();
  const map = h.maps[0]; map.handlers.load();
  assert.equal(visibility(map, "journal-satellite"), "visible");
  assert.equal(visibility(map, "journal-power-line"), "visible");
  assert.equal(h.runtimes[0].requests.length, 1);
  const features = [{ type: "Feature", properties: { name: "Zone test", type: 1 }, geometry: { type: "Polygon", coordinates: [[[3, 50], [3.1, 50], [3.1, 50.1], [3, 50]]] } }];
  const after = { type: "FeatureCollection", features };
  h.setCoverage(after); h.render();
  assert.deepEqual(map.sources["journal-airspaces"].data, airspaceStyle.prepareAirspacesForMap(after, { currentAltitudeMeters: null }));
  assert.equal(map.sources["journal-airspaces"].data.features.length, 1);
  assert.equal((map.listeners.load ?? []).length, 1); // Only the original initialization listener remains.
});

test("sans clé MapTiler le satellite est désactivé et OSM reste visible", t => {
  const h = harness(t, "");
  let tree = h.render(); h.maps[0].handlers.load(); openMap(tree); tree = h.render();
  assert.equal(findButton(tree, "Satellite").props.disabled, true);
  assert.equal(h.maps[0].getLayer("journal-satellite"), undefined);
  assert.equal(visibility(h.maps[0], "journal-plan"), "visible");
});
