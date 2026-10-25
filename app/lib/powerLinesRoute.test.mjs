import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildPowerLinesQuery, parsePowerLines, validatePowerLineResult } from './powerLines.ts';

const raw = readFileSync(new URL('../api/osm/power-lines/route.ts', import.meta.url), 'utf8').replace(/import\s*\{[\s\S]*?\}\s*from\s*[^;]+;/, '');
const code = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const bounds = { west: 3, south: 50.6, east: 3.15, north: 50.7 };
const request = () => new Request(`http://localhost/api/osm/power-lines?${new URLSearchParams(bounds)}`);
const success = () => Response.json({ elements: [{ id: 1, tags: { power: 'line' }, geometry: [{ lon: 3.01, lat: 50.61 }, { lon: 3.02, lat: 50.62 }] }] });
function harness(t, outcomes) {
  const calls = [], logs = [], budgets = [];
  let now = 0;
  const exports = {};
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const outcome = outcomes[calls.length - 1];
    assert.ok(outcome, 'unexpected extra provider attempt');
    return outcome();
  };
  new Function('exports', 'buildPowerLinesQuery', 'parsePowerLines', 'fetch', 'console', 'Date', 'AbortSignal', code)(
    exports, buildPowerLinesQuery, parsePowerLines, fetcher, { warn: (...args) => logs.push(args) },
    class extends Date { static now() { return now; } },
    { timeout(ms) { budgets.push(ms); return new AbortController().signal; } },
  );
  return { calls, logs, budgets, GET: exports.GET, advance(ms) { now += ms; } };
}
for (const status of [429, 502, 503, 504]) test(`HTTP ${status} falls back once and preserves C10 envelope`, async t => {
  const h = harness(t, [() => new Response('', { status }), success]);
  const result = await h.GET(request());
  assert.equal(result.status, 200);
  const data = validatePowerLineResult(await result.json(), bounds);
  assert.equal(data.features.length, 1);
  assert.equal(data.complete, true);
  assert.match(result.headers.get('Cache-Control'), /max-age=3600/);
  assert.deepEqual(h.calls.map(call => call.url), ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
  assert.equal(h.calls[1].options.method, 'POST');
  assert.equal(h.calls[0].options.body.toString(), h.calls[1].options.body.toString());
  assert.equal(h.logs[0][1].status, status);
});
test('timeout falls back with a bounded remaining budget', async t => {
  const h = harness(t, [() => { h.advance(6500); throw new DOMException('expired', 'TimeoutError'); }, success]);
  assert.equal((await h.GET(request())).status, 200);
  assert.deepEqual(h.budgets, [6000, 5500]);
  assert.equal(h.logs[0][1].cause, 'timeout');
});
for (const [name, outcome] of [
  ['400', () => new Response('', { status: 400 })],
  ['500', () => new Response('', { status: 500 })],
  ['network', () => { throw new TypeError('network failure'); }],
  ['invalid JSON', () => new Response('invalid')],
  ['invalid schema', () => Response.json({})],
]) test(`${name} does not trigger fallback`, async t => {
  const h = harness(t, [outcome]);
  const result = await h.GET(request());
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.calls.length, 1);
});
test('both failures stop after two attempts and never cache errors', async t => {
  const h = harness(t, [() => new Response('', { status: 502 }), () => { throw new DOMException('expired', 'TimeoutError'); }]);
  const result = await h.GET(request());
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'Données indisponibles' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.calls.length, 2);
  assert.equal(h.budgets.reduce((a, b) => a + b), 12000);
});
test('expired total budget prevents a second request', async t => {
  const h = harness(t, [() => { h.advance(12000); throw new DOMException('expired', 'TimeoutError'); }]);
  assert.equal((await h.GET(request())).status, 503);
  assert.equal(h.calls.length, 1);
});
test('partial C10 remains partial without fallback; invalid bounds are no-store', async t => {
  const h = harness(t, [() => Response.json({ elements: [], remark: 'runtime error' })]);
  const result = await h.GET(request());
  const data = validatePowerLineResult(await result.json(), bounds);
  assert.equal(data.complete, false);
  assert.equal(data.emptyConfirmed, false);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  const invalid = await h.GET(new Request('http://localhost/api/osm/power-lines?west=4&east=3'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.calls.length, 1);
});
test('primary success does not contact secondary', async t => {
  const h = harness(t, [success]);
  assert.equal((await h.GET(request())).status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.logs.length, 0);
});
test('timeout while reading response body also falls back', async t => {
  const h = harness(t, [() => ({ ok: true, status: 200, json: async () => { throw new DOMException('body timeout', 'TimeoutError'); } }), success]);
  assert.equal((await h.GET(request())).status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.logs[0][1].status, 200);
  assert.equal(h.logs[0][1].cause, 'timeout');
});
