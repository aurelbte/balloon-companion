import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as orchestration from './trajectory/multiProjectionServer.ts';
import * as adapter from './weather/openMeteo/adapter.ts';
import * as parser from './weather/openMeteo/parser.ts';
import * as integration from './trajectory/integration.ts';
import * as arrival from './moroccoArrivalWeather.ts';
import { moroccoCalculationAcquisitionOptions } from './moroccoPreparationIntent.ts';

function route({ groundFails = false } = {}) {
  const requests = [];
  const raw = { latitude: 31.5, longitude: -8, elevation: 47, generationtime_ms: 7, hourly_units: { wind_speed_10m: 'm/s', wind_direction_10m: '°', wind_speed_180m: 'm/s', wind_direction_180m: '°', wind_speed_850hPa: 'm/s', wind_direction_850hPa: '°', geopotential_height_850hPa: 'm' }, hourly: {
    time: ['2026-11-05T09:00','2026-11-05T10:00','2026-11-05T11:00','2026-11-05T12:00'], wind_speed_10m: [2,2,2,2], wind_direction_10m: [240,240,240,240], wind_speed_180m: [4,4,4,4], wind_direction_180m: [240,240,240,240], wind_speed_850hPa: [6,6,6,6], wind_direction_850hPa: [240,240,240,240], geopotential_height_850hPa: [1500,1500,1500,1500] } };
  const client = { async fetchElevation() { requests.push('elevation'); return { elevation: [47] }; }, async fetchWindColumn() { requests.push('wind'); return raw; }, async fetchHourlyForecast(query) {
    requests.push({ ground: query });
    if (groundFails) throw new Error('https://provider.invalid?apikey=private');
    return { latitude: query.latitude, longitude: query.longitude, utc_offset_seconds: 0, hourly_units: { wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' }, hourly: { time: ['2026-11-05T11:00'], wind_speed_10m: [12], wind_direction_10m: [270], wind_gusts_10m: [18] } };
  } };
  const mocks = {
    '../../../lib/trajectory/multiProjectionServer': orchestration,
    '../../../lib/weather/openMeteo/adapter': adapter,
    '../../../lib/weather/openMeteo/parser': parser,
    '../../../lib/trajectory/integration': integration,
    '../../../lib/moroccoArrivalWeather': arrival,
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
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, archiveMoroccoWeather, acquireMoroccoArrivalWeather: archiveMoroccoWeather }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(requests.slice(0, 2), ['elevation','wind']);
    assert.equal(requests.filter(item => item === 'wind').length, 1); // Calculation body is never reloaded.
    if (!archiveMoroccoWeather) assert.equal(requests.length, 2);
    return body;
  };
  const baseline = await run(false), archived = await run(true);
  assert.equal(baseline.moroccoCalculation, undefined);
  assert.deepEqual(archived.layerProjections, baseline.layerProjections);
  assert.deepEqual(archived.flightProfileProjection, baseline.flightProfileProjection);
  assert.deepEqual(archived.windProfile, baseline.windProfile);
  assert.ok(archived.moroccoCalculation.rawForecasts.some(raw => raw.kind === 'ground'));
  assert.deepEqual(archived.moroccoCalculation.rawForecasts[0].payload, raw);
  assert.equal(archived.moroccoCalculation.request.climbRateMps, 2);
  assert.equal(archived.moroccoCalculation.request.descentRateMps, 2);
  assert.equal(archived.moroccoCalculation.request.launchTimeZone, 'Africa/Casablanca');
  assert.equal(archived.moroccoCalculation.rawForecasts[0].kind, 'calculation');
  assert.ok(Number.isFinite(Date.parse(archived.moroccoCalculation.rawForecasts[0].receivedAt)));
  assert.doesNotMatch(JSON.stringify(archived), /test-key-must-not-be-returned|apikey/);
  const points = [...archived.layerProjections.map(p => p.projection.points.at(-1)), archived.flightProfileProjection?.points.at(-1)].filter(Boolean);
  assert.equal(requests.filter(item => typeof item === 'object').length, new Set(points.map(p => JSON.stringify([p.latitude, p.longitude, p.timestamp]))).size);
  for (const raw of archived.moroccoCalculation.rawForecasts.filter(raw => raw.kind === 'ground')) {
    assert.ok(points.some(p => p.latitude === raw.query.latitude && p.longitude === raw.query.longitude && p.timestamp === raw.query.landingAt));
    assert.equal(raw.model, input.weatherModel);
    assert.equal(raw.query.startAt, '2026-11-05T08:00:00.000Z');
    assert.equal(raw.query.endAt, new Date(Date.parse(raw.query.landingAt) + 7200000).toISOString());
  }
});

test('arrival acquisition failure preserves successful trajectories and departure evidence without leaking provider secrets', async () => {
  const { POST } = route({ groundFails: true });
  const body = await (await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, ...moroccoCalculationAcquisitionOptions(true) }) }))).json();
  assert.equal(body.ok, true); assert.ok(body.layerProjections.length);
  assert.equal(body.moroccoCalculation.rawForecasts.length, 1);
  assert.match(body.moroccoCalculation.notices.join(' '), /acquisition échouée/);
  assert.doesNotMatch(JSON.stringify(body), /private|apikey|provider.invalid/);
});

test('normal /map calculation preserves departure capture with zero additional arrival requests; explicit Morocco /map opts in', async () => {
  const { POST, requests } = route();
  const run = async enabled => {
    requests.length = 0;
    const body = await (await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, ...moroccoCalculationAcquisitionOptions(enabled) }) }))).json();
    assert.equal(body.ok, true); return body;
  };
  const normal = await run(false);
  assert.deepEqual(requests, ['elevation','wind']);
  assert.equal(normal.moroccoCalculation.rawForecasts.length, 1);
  const morocco = await run(true);
  assert.ok(requests.some(r => typeof r === 'object'));
  assert.ok(morocco.moroccoCalculation.rawForecasts.some(r => r.kind === 'ground'));
  assert.deepEqual(morocco.layerProjections, normal.layerProjections);
});
