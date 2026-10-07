import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual trajectory effect without mounting WebGL or a browser.
const source = readFileSync(new URL("../components/PreparationMap.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("PreparationMap.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[1]?.getText(ast).includes("traceData")) {
    effect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect, "trajectory synchronization effect exists");
const constants = ast.statements.filter((node) => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some((declaration) => /^(TRACE|TIME|ARRIVAL|START)_SOURCE$/.test(declaration.name.getText(ast))))
  .map((node) => node.getText(ast)).join("\n");
const { outputText } = ts.transpileModule(`${constants}\nconst runEffect = ${effect};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

function fixture(initialized) {
  const sources = new Map();
  const listeners = new Map();
  const updates = new Map();
  const map = {
    loaded: () => false,
    getSource: (id) => sources.get(id),
    getLayer: () => undefined,
    once: (event, callback) => listeners.set(event, callback),
    off: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); },
  };
  const initialize = () => {
    for (const id of ["analysis-trajectories", "analysis-time-markers", "analysis-arrivals", "analysis-start"]) {
      sources.set(id, { setData: (data) => updates.set(id, data) });
    }
  };
  if (initialized) initialize();
  const traceData = { type: "FeatureCollection", features: [{
    type: "Feature", properties: { traceId: "arome:300" },
    geometry: { type: "LineString", coordinates: [[3, 50], [3.1, 50.1]] },
  }] };
  const empty = { type: "FeatureCollection", features: [] };
  const run = new Function("mapRef", "traceData", "timeData", "arrivalData", "startData", "layers", "MODEL_LINE_STYLES",
    `${outputText}\nreturn runEffect();`);
  return { updates, listeners, initialize, traceData,
    run: () => run({ current: map }, traceData, empty, empty, empty, { trajectories: true }, {}) };
}

test("new trajectories sync after the initial load even while loaded() is false", () => {
  // Initial load has already created the sources; no further load event will fire.
  const state = fixture(true);
  const cleanup = state.run();
  assert.equal(state.updates.get("analysis-trajectories"), state.traceData);
  assert.equal(state.updates.size, 4);
  assert.equal(state.listeners.size, 0);
  cleanup();
});

test("initialization waits for load and cancels obsolete synchronization", () => {
  const state = fixture(false);
  const cleanup = state.run();
  assert.equal(state.updates.size, 0);
  assert.ok(state.listeners.has("load"));
  cleanup();
  assert.equal(state.listeners.size, 0);
  state.run();
  state.initialize();
  state.listeners.get("load")();
  assert.equal(state.updates.get("analysis-trajectories"), state.traceData);
  assert.equal(state.updates.size, 4);
});
