import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as orchestration from './trajectory/multiProjectionServer.ts';
import * as adapter from './weather/openMeteo/adapter.ts';
import * as parser from './weather/openMeteo/parser.ts';
import * as integration from './trajectory/integration.ts';

function route() {
  const requests = [];
  const raw = { latitude: 31.5, longitude: -8, elevation: 47, generationtime_ms: 7, hourly_units: { wind_speed_10m: 'm/s', wind_direction_10m: '°', wind_speed_180m: 'm/s', wind_direction_180m: '°', wind_speed_850hPa: 'm/s', wind_direction_850hPa: '°', geopotential_height_850hPa: 'm' }, hourly: {
    time: ['2026-11-05T09:00','2026-11-05T10:00','2026-11-05T11:00','2026-11-05T12:00'], wind_speed_10m: [2,2,2,2], wind_direction_10m: [240,240,240,240], wind_speed_180m: [4,4,4,4], wind_direction_180m: [240,240,240,240], wind_speed_850hPa: [6,6,6,6], wind_direction_850hPa: [240,240,240,240], geopotential_height_850hPa: [1500,1500,1500,1500] } };
  const client = { async fetchElevation() { requests.push('elevation'); return { elevation: [47] }; }, async fetchWindColumn() { requests.push('wind'); return raw; } };
  const mocks = {
    '../../../lib/trajectory/multiProjectionServer': orchestration,
    '../../../lib/weather/openMeteo/adapter': adapter,
    '../../../lib/weather/openMeteo/parser': parser,
    '../../../lib/trajectory/integration': integration,
    '../../../lib/weather/openMeteo/client': { getOpenMeteoServerConfig: () => ({ tier: 'commercial', apiKey: 'test-key-must-not-be-returned' }), createOpenMeteoClient: () => client },
  };
  const js = ts.transpileModule(readFileSync(new URL('../api/trajectory/project/route.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; new Function('require', 'exports', js)(id => { if (!(id in mocks)) throw new Error(`unexpected dependency ${id}`); return mocks[id]; }, exports);
  return { POST: exports.POST, requests, raw };
}
const input = { version: 2, launchSite: { name: 'Marrakech', latitude: 31.5, longitude: -8 }, launchDateTimeIso: '2026-11-05T10:00:00Z', launchTimeZone: 'Africa/Casablanca', durationSeconds: 3600, weatherModel: 'ecmwf_ifs025', altitudesAmslM: [300,600], primaryAltitudeAmslM: 600, climbRateMps: 2, descentRateMps: 2 };

test('opt-in Morocco evidence copies the one weather body actually consumed; all computed trajectories remain identical', async () => {
  const { POST, requests, raw } = route();
  const run = async archiveMoroccoWeather => {
    requests.length = 0;
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, archiveMoroccoWeather }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(requests, ['elevation','wind']); // no second forecast, ground forecast or aviation lookup
    return body;
  };
  const baseline = await run(false), archived = await run(true);
  assert.equal(baseline.moroccoCalculation, undefined);
  assert.deepEqual(archived.layerProjections, baseline.layerProjections);
  assert.deepEqual(archived.flightProfileProjection, baseline.flightProfileProjection);
  assert.deepEqual(archived.windProfile, baseline.windProfile);
  assert.equal(archived.moroccoCalculation.rawForecasts.length, 1);
  assert.deepEqual(archived.moroccoCalculation.rawForecasts[0].payload, raw);
  assert.equal(archived.moroccoCalculation.request.climbRateMps, 2);
  assert.equal(archived.moroccoCalculation.request.descentRateMps, 2);
  assert.equal(archived.moroccoCalculation.request.launchTimeZone, 'Africa/Casablanca');
  assert.equal(archived.moroccoCalculation.rawForecasts[0].kind, 'calculation');
  assert.ok(Number.isFinite(Date.parse(archived.moroccoCalculation.rawForecasts[0].receivedAt)));
  assert.doesNotMatch(JSON.stringify(archived), /test-key-must-not-be-returned|apikey/);
});
