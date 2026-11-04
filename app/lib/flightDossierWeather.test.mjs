import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { prepareFlightDossierWeather, isFlightDossierWeatherRequest } from './flightDossierWeather.ts';
import { normalizeStationLocations, loadAviationStationLocations, clearAirportSearchCacheForTests } from './aviation/airportSearch.ts';
import { loadFlightDossierWeather } from './flightDossierWeatherClient.ts';
import { createOpenMeteoClient } from './weather/openMeteo/client.ts';
import { parseOpenMeteoWindColumn } from './weather/openMeteo/parser.ts';
import { clearAviationWeatherCacheForTests } from './aviation/aviationWeather.ts';
import { POST } from '../api/preparation/flight-dossier-weather/route.ts';

const input = { traceId: 'chosen', weatherModel: 'arome_seamless', departure: { latitude: 50, longitude: 3, timestamp: '2026-11-04T23:30:00Z' }, landing: { latitude: 51, longitude: 4, timestamp: '2026-11-05T01:30:00Z' } };
const stations = normalizeStationLocations([
  { icaoId: 'LFQO', site: 'No advertised product', lat: 50, lon: 3 },
  { icaoId: 'LFQQ', site: 'METAR departure', lat: 50.01, lon: 3, siteType: ['METAR'] },
  { icaoId: 'EBBR', site: 'TAF departure', lat: 50.2, lon: 3, siteType: ['TAF'] },
  { icaoId: 'EBAW', site: 'Arrival', lat: 51, lon: 4, siteType: ['METAR', 'TAF'] },
  { icaoId: 'XXXX', site: 'Broken', lat: 200, lon: 3, siteType: ['METAR'] },
]);
const validAt = '2026-11-05T00:00:00.000Z';
const level = { sourceType: 'pressure-level', sourceLevel: '850 hPa', geopotentialHeightAmslM: 1500, windSpeedMps: 5, windDirectionFromDeg: 270 };
function setup(overrides = {}) {
  const calls = { aviation: [], altitude: [], ground: [] };
  return { calls, services: {
    stations: async () => stations,
    aviation: async (icao) => { calls.aviation.push(icao); return { data: { airport: icao, metarRaw: 'METAR raw', tafRaw: 'TAF raw', metarIssuedAt: validAt, tafIssuedAt: validAt, sourceUpdatedAt: validAt, status: 'STALE' }, error: null }; },
    altitude: async query => { calls.altitude.push(query); return { fetchedAt: validAt, column: { sourceModel: query.weatherModel, sourceLatitude: 50.02, sourceLongitude: 3.02, slices: [{ validAt, levels: [level], rejectedLevels: [{ sourceLevel: '80 m AGL', reason: 'absent' }] }] } }; },
    ground: async query => { calls.ground.push(query); return { model: query.weatherModel, latitude: 51.02, longitude: 4.02, sourceUpdatedAt: validAt, points: [{ timestamp: '2026-11-05T00:00', model: query.weatherModel, windSpeedKmh: 12, windDirectionDeg: 250 }] }; },
    ...overrides,
  } };
}

test('station catalogue preserves coordinates and advertised products, rejects unsuitable stations', async () => {
  assert.equal(stations.length, 3);
  clearAirportSearchCacheForTests();
  let requests = 0;
  const fetcher = async () => { requests++; return new Response(gzipSync(JSON.stringify([{ icaoId: 'LFQQ', site: 'Lille', lat: 50.57, lon: 3.1, siteType: ['METAR', 'TAF'] }]))); };
  const loaded = await loadAviationStationLocations(fetcher, 0);
  assert.equal(loaded[0].latitude, 50.57);
  await loadAviationStationLocations(fetcher, 1);
  assert.equal(requests, 1);
  clearAirportSearchCacheForTests();
});

test('nearest station per product and endpoint; one aviation call per ICAO, raw dates and stale status preserved', async () => {
  const { services, calls } = setup();
  const data = await prepareFlightDossierWeather(input, services);
  assert.equal(data.traceId, input.traceId);
  assert.equal(data.aviation.departure.metar.station.icao, 'LFQQ');
  assert.equal(data.aviation.departure.taf.station.icao, 'EBBR');
  assert.equal(data.aviation.landing.taf.station.icao, 'EBAW');
  assert.equal(data.aviation.landing.taf.station.distanceKm, 0);
  assert.equal(data.aviation.departure.metar.station.distanceKm > 1, true);
  assert.deepEqual(calls.aviation.sort(), ['EBAW', 'EBBR', 'LFQQ']);
  assert.equal(data.aviation.departure.metar.status, 'STALE');
  assert.equal(data.aviation.departure.metar.result.data.metarRaw, 'METAR raw');
  assert.equal(data.aviation.departure.metar.result.data.metarIssuedAt, validAt);
});

test('exact window across midnight, selected model only, real times and missing hours/fields without interpolation', async () => {
  const { services, calls } = setup();
  const data = await prepareFlightDossierWeather(input, services);
  assert.equal(data.window.startAt, '2026-11-04T21:30:00.000Z');
  assert.equal(data.window.endAt, '2026-11-05T03:30:00.000Z');
  assert.equal(data.window.expectedHours.length, 6);
  assert.equal(calls.altitude[0].weatherModel, input.weatherModel);
  assert.equal(calls.ground[0].weatherModel, input.weatherModel);
  assert.equal(calls.altitude[0].latitude, input.departure.latitude);
  assert.equal(calls.ground[0].latitude, input.landing.latitude);
  assert.equal(data.altitudeWind.points.length, 1);
  assert.equal(data.altitudeWind.points[0].validAt, validAt);
  assert.equal(data.altitudeWind.points[0].levels[0].windSpeedMps, 5);
  assert.equal(data.altitudeWind.missingHours.length, 5);
  assert.equal(data.altitudeWind.status, 'PARTIAL');
  assert.equal(data.landingGroundWind.points[0].validAt, validAt);
  assert.deepEqual(data.landingGroundWind.points[0].unavailableFields, ['gustKmh']);
  assert.equal(data.landingGroundWind.points[0].gustKmh, null);
  assert.equal(data.altitudeWind.points[0].gusts, null);
  assert.equal(data.altitudeWind.modelRunAt, null);
});

test('independent failures and mismatched model never cause model or hour substitution', async () => {
  const { services } = setup({
    stations: async () => { throw Error('offline'); },
    altitude: async () => { throw Error('vertical unavailable'); },
    ground: async () => ({ model: 'gfs_seamless', points: [] }),
  });
  const data = await prepareFlightDossierWeather(input, services);
  assert.equal(data.aviation.departure.metar.status, 'UNAVAILABLE');
  assert.equal(data.altitudeWind.status, 'UNAVAILABLE');
  assert.equal(data.altitudeWind.error, 'vertical unavailable');
  assert.equal(data.landingGroundWind.status, 'UNAVAILABLE');
  assert.match(data.landingGroundWind.error, /différent/);
  assert.equal(data.landingGroundWind.points.length, 0);
  assert.equal(data.landingGroundWind.missingHours.length, 6);
});

test('unavailable METAR is not labelled available because TAF exists', async () => {
  const { services } = setup({ aviation: async () => ({ data: { metarRaw: null, tafRaw: 'TAF', status: 'PARTIAL' }, error: null }) });
  const data = await prepareFlightDossierWeather(input, services);
  assert.equal(data.aviation.departure.metar.status, 'UNAVAILABLE');
  assert.equal(data.aviation.departure.taf.status, 'PARTIAL');
});

test('optional bounded acquisition preserves legacy Open-Meteo requests', async () => {
  const urls = [];
  const client = createOpenMeteoClient({ tier: 'free', fetchImpl: async url => { urls.push(new URL(url)); return Response.json({}); } });
  await client.fetchWindColumn({ ...input.departure, validAt: '2026-11-04T21:30:00Z', endValidAt: '2026-11-06T03:30:00Z', weatherModel: input.weatherModel });
  await client.fetchHourlyForecast({ ...input.landing, startAt: '2026-11-04T21:30:00Z', endAt: '2026-11-06T03:30:00Z', weatherModel: input.weatherModel });
  assert.equal(urls[0].searchParams.get('end_date'), '2026-11-06');
  assert.equal(urls[1].searchParams.get('start_date'), '2026-11-04');
  assert.equal(urls[1].searchParams.get('timezone'), 'UTC');
  assert.equal(urls[1].searchParams.has('forecast_days'), false);
  assert.equal(urls.every(url => url.searchParams.get('models') === input.weatherModel), true);
  await client.fetchHourlyForecast({ ...input.landing, weatherModel: input.weatherModel });
  assert.equal(urls[2].searchParams.get('forecast_days'), '7');
  assert.equal(urls[2].searchParams.get('timezone'), 'auto');
});

test('dossier parser retains sparse hours; default parser requirements unchanged', () => {
  const payload = { latitude: 50, longitude: 3, elevation: 0, hourly_units: { wind_speed_80m: 'm/s', wind_direction_80m: '°' }, hourly: { time: ['2026-11-05T00:00', '2026-11-05T01:00'], wind_speed_80m: [5, null], wind_direction_80m: [270, null] } };
  assert.throws(() => parseOpenMeteoWindColumn(payload, input.weatherModel));
  const column = parseOpenMeteoWindColumn(payload, input.weatherModel, undefined, 0);
  assert.equal(column.slices.length, 2);
  assert.equal(column.slices[0].levels.length, 1);
  assert.equal(column.slices[1].levels.length, 0);
  assert.ok(column.slices[1].rejectedLevels.length);
});

test('invalid input is rejected before services are called, route returns 400 no-store', async () => {
  const invalid = { ...input, weatherModel: 'best_match' };
  assert.equal(isFlightDossierWeatherRequest(invalid), false);
  assert.equal(isFlightDossierWeatherRequest({ ...input, landing: { ...input.landing, latitude: 91 } }), false);
  await assert.rejects(prepareFlightDossierWeather(invalid, {}), /invalide/);
  const response = await POST(new Request('http://localhost/api/preparation/flight-dossier-weather', { method: 'POST', body: JSON.stringify(invalid) }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('client is lazy; sends only selected trace endpoints and model after explicit invocation', async () => {
  let calls = 0;
  const dossier = { traceId: input.traceId, model: { providerModelId: input.weatherModel }, points: [input.departure, input.landing] };
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, '/api/preparation/flight-dossier-weather');
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json({ data: { traceId: input.traceId, weatherModel: input.weatherModel } });
  };
  assert.equal(calls, 0);
  await loadFlightDossierWeather(dossier, undefined, fetcher);
  assert.equal(calls, 1);
  await assert.rejects(loadFlightDossierWeather(dossier, undefined, async () => Response.json({ data: { traceId: 'other', weatherModel: input.weatherModel } })), /indisponibles/);
});


test('route assembles real service formats and keeps the explicit UTC window and model', async () => {
  const originalFetch = globalThis.fetch;
  clearAirportSearchCacheForTests();
  clearAviationWeatherCacheForTests();
  const requests = [];
  globalThis.fetch = async rawUrl => {
    const url = new URL(rawUrl);
    requests.push(url);
    if (url.pathname.endsWith('stations.cache.json.gz')) return Response.json([{ icaoId: 'LFQQ', site: 'Lille', lat: 50.57, lon: 3.1, siteType: ['METAR', 'TAF'] }]);
    if (url.hostname === 'aviationweather.gov') return new Response(url.pathname.endsWith('/metar') ? 'LFQQ 050000Z 25005KT CAVOK' : 'TAF LFQQ 050000Z 0500/0600 25005KT CAVOK');
    assert.equal(url.searchParams.get('models'), input.weatherModel);
    assert.equal(url.searchParams.get('start_date'), '2026-11-04');
    assert.equal(url.searchParams.get('end_date'), '2026-11-05');
    assert.equal(url.searchParams.get('timezone'), 'UTC');
    const vertical = url.searchParams.get('wind_speed_unit') === 'ms';
    return Response.json({ latitude: 50, longitude: 3, elevation: 100, hourly_units: vertical ? { wind_speed_80m: 'm/s', wind_direction_80m: '°' } : { wind_speed_10m: 'km/h' }, hourly: { time: ['2026-11-05T00:00'], ...(vertical ? { wind_speed_80m: [5], wind_direction_80m: [250] } : { wind_speed_10m: [18], wind_direction_10m: [250], wind_gusts_10m: [28] }) } });
  };
  try {
    const response = await POST(new Request('http://localhost/api/preparation/flight-dossier-weather', { method: 'POST', body: JSON.stringify(input) }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.traceId, input.traceId);
    assert.equal(data.altitudeWind.points[0].levels[0].windSpeedMps, 5);
    assert.equal(data.landingGroundWind.points[0].gustKmh, 28);
    assert.equal(data.aviation.departure.metar.result.data.airport, 'LFQQ');
    assert.equal(requests.length, 5); // catalogue, two forecasts, METAR + TAF (shared station).
  } finally {
    globalThis.fetch = originalFetch;
    clearAirportSearchCacheForTests();
    clearAviationWeatherCacheForTests();
  }
});
