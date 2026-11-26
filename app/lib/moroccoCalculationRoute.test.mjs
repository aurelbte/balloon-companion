import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as orchestration from './trajectory/multiProjectionServer.ts';
import * as adapter from './weather/openMeteo/adapter.ts';
import * as parser from './weather/openMeteo/parser.ts';
import * as integration from './trajectory/integration.ts';
import * as arrival from './moroccoArrivalWeather.ts';
import * as aviationCapture from './moroccoCalculationAviation.ts';

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
    '../../../lib/moroccoCalculationAviation': { captureCalculationAviation: result => aviationCapture.captureCalculationAviation(result,{stations:async()=>[],aviation:async()=>({data:null,error:null})}) },
    '../../../lib/weather/openMeteo/client': { getOpenMeteoServerConfig: () => ({ tier: 'commercial', apiKey: 'test-key-must-not-be-returned' }), createOpenMeteoClient: () => client },
  };
  const js = ts.transpileModule(readFileSync(new URL('../api/trajectory/project/route.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; new Function('require', 'exports', js)(id => { if (!(id in mocks)) throw new Error(`unexpected dependency ${id}`); return mocks[id]; }, exports);
  return { POST: exports.POST, requests, raw, client };
}
const input = { version: 2, launchSite: { name: 'Marrakech', latitude: 31.5, longitude: -8 }, launchDateTimeIso: '2026-11-05T10:00:00Z', launchTimeZone: 'Africa/Casablanca', durationSeconds: 3600, weatherModel: 'ecmwf_ifs025', altitudesAmslM: [300,600], primaryAltitudeAmslM: 600, climbRateMps: 2, descentRateMps: 2 };

test('normal calculation automatically copies the exact consumed weather and acquires arrivals; motor output remains identical', async () => {
  const { POST, requests, raw, client } = route();
  const run = async archiveMoroccoWeather => {
    requests.length = 0;
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, archiveMoroccoWeather, acquireMoroccoArrivalWeather: archiveMoroccoWeather }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(requests.slice(0, 2), ['elevation','wind']);
    assert.equal(requests.filter(item => item === 'wind').length, 1); // Calculation body is never reloaded.
    return body;
  };
  const baseline = (await orchestration.orchestrateMultiAltitudeProjection(input,{ getTerrainAltitude:async()=>47, createWindProvider:altitude=>new adapter.OpenMeteoWindProvider(client,altitude) })).body;
  const archived = await run(false);
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
  const body = await (await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input }) }))).json();
  assert.equal(body.ok, true); assert.ok(body.layerProjections.length);
  assert.equal(body.moroccoCalculation.rawForecasts.length, 1);
  assert.match(body.moroccoCalculation.notices.join(' '), /acquisition échouée/);
  assert.doesNotMatch(JSON.stringify(body), /private|apikey|provider.invalid/);
});

test('ordinary request needs no destination flag and legacy opt-out flags do not disable evidence',async()=>{
 const {POST,requests}=route();
 for(const payload of [input,{...input,archiveMoroccoWeather:false,acquireMoroccoArrivalWeather:false}]) {
  requests.length=0;
  const body=await(await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify(payload)}))).json();
  assert.equal(body.ok,true);assert.equal(requests.filter(r=>r==='wind').length,1);
  assert.ok(body.moroccoCalculation.rawForecasts.some(r=>r.kind==='ground'));assert.ok(body.moroccoCalculation.aviation.length);
 }
});

test('METAR/TAF acquisition reuses existing station services and original emissions, with station requests deduplicated',async()=>{
 const {POST}=route();const body=await(await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify(input)}))).json();
 let calls=0,stationCalls=0;
 const station={icao:'GMMX',name:'Marrakech',latitude:31.6,longitude:-8,products:['METAR','TAF']};
 const data={airport:'GMMX',metarRaw:'GMMX METAR fixture',tafRaw:'GMMX TAF fixture',metarIssuedAt:'2026-11-05T08:00:00Z',tafIssuedAt:'2026-11-05T06:00:00Z',sourceUpdatedAt:new Date().toISOString(),status:'AVAILABLE'};
 const captured=await aviationCapture.captureCalculationAviation(body,{stations:async()=>{stationCalls++;return[station];},aviation:async()=>{calls++;return{data,error:null};}});
 assert.equal(stationCalls,1);assert.equal(calls,1);assert.ok(captured.length);
 assert.equal(captured[0].data.departure.metar.result.data.metarRaw,data.metarRaw);
 assert.equal(captured[0].data.landing.taf.result.data.tafIssuedAt,data.tafIssuedAt);
 assert.equal(captured[0].data.landing.taf.result.data.sourceUpdatedAt,data.sourceUpdatedAt);
});
