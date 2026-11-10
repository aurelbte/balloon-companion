import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMoroccoHistoricalAviation, prepareMoroccoDossierWeather } from './moroccoDossierWeather.ts';
import { loadMoroccoFlightDossierWeather } from './flightDossierWeatherClient.ts';
import { POST } from '../api/preparation/morocco-dossier-weather/route.ts';
const referenceAt = '2026-11-05T10:00:00.000Z';
const now = Date.parse('2026-11-10T12:00:00Z');
const sec = iso => Date.parse(iso) / 1000;
const metar = { icaoId: 'GMMX', reportTime: '2026-11-05 09:30:00.000Z', receiptTime: '2026-11-05 09:32:00.000Z', obsTime: sec('2026-11-05T09:30:00Z'), rawOb: 'GMMX 050930Z 00000KT CAVOK' };
const taf = { icaoId: 'GMMX', issueTime: '2026-11-05 09:00:00.000Z', dbPopTime: '2026-11-05 09:02:00.000Z', validTimeFrom: sec('2026-11-05T09:00:00Z'), validTimeTo: sec('2026-11-06T09:00:00Z'), rawTAF: 'TAF GMMX 050900Z 0509/0609 00000KT CAVOK' };
const load = (product, rows, extra = {}) => loadMoroccoHistoricalAviation({ airport: 'GMMX', product, referenceAt, validAt: referenceAt, now, fetchImpl: async url => {
  assert.equal(url.searchParams.get('date'), new Date(Math.min(Date.parse(extra.referenceAt ?? referenceAt), Date.parse(extra.validAt ?? referenceAt))).toISOString());
  assert.equal(url.searchParams.get('format'), 'json');
  if (product === 'taf') assert.equal(url.searchParams.get('time'), 'issue');
  return Response.json(rows);
}, ...extra });

test('historical METAR excludes later issue, delayed receipt, wrong station and missing timestamps', async () => {
  const result = await load('metar', [metar, { ...metar, reportTime: '2026-11-05T10:01:00Z' }, { ...metar, receiptTime: '2026-11-05T10:01:00Z' }, { ...metar, icaoId: 'LFQQ' }]);
  assert.equal(result.data.metarRaw, metar.rawOb);
  assert.equal(result.provenance.receivedAt, '2026-11-05T09:32:00.000Z');
  assert.equal(result.data.sourceUpdatedAt, new Date(now).toISOString());
  assert.match((await load('metar', [{ ...metar, receiptTime: undefined }])).error.message, /Disponibilité non attestée/);
  assert.equal((await load('metar', [metar], { validAt: '2026-11-05T12:00:00Z' })).data, null);
});

test('TAF uses only pre-reference versions valid at flight time and does not resurrect cancelled versions', async () => {
  assert.equal((await load('taf', [taf, { ...taf, issueTime: '2026-11-05T11:00:00Z' }], { validAt: '2026-11-05T15:00:00Z' })).data.tafRaw, taf.rawTAF);
  assert.equal((await load('taf', [taf], { validAt: '2026-11-06T09:00:00Z' })).data, null);
  const cancelled = { ...taf, issueTime: '2026-11-05T09:45:00Z', dbPopTime: '2026-11-05T09:46:00Z', rawTAF: 'TAF GMMX CNL' };
  assert.equal((await load('taf', [taf, cancelled])).data, null);
  assert.match((await load('taf', [{ ...taf, dbPopTime: undefined }])).error.message, /Disponibilité non attestée/);
});

test('outside archive or future reference never fetches current data; errors and empty responses stay unavailable', async () => {
  const fetchImpl = async () => { throw new Error('must not fetch'); };
  for (const date of ['2026-09-01T10:00:00Z', '2026-11-11T10:00:00Z']) assert.match((await load('metar', [], { referenceAt: date, fetchImpl })).error.message, /Non disponible/);
  assert.equal((await load('metar', [], { fetchImpl: async () => new Response(null, { status: 204 }) })).data, null);
  assert.match((await load('metar', [], { fetchImpl: async () => { throw new Error('offline'); } })).error.message, /aucune substitution actuelle/);
});

const input = { traceId: 'test', weatherModel: 'ecmwf_ifs025', availabilityReferenceAt: referenceAt, departure: { latitude: 31, longitude: -8, timestamp: '2026-11-05T10:00:00Z' }, landing: { latitude: 31.1, longitude: -8, timestamp: '2026-11-05T11:00:00Z' } };
test('Morocco keeps flight validity and UTC cutoff, blocks unattested runs without any Open-Meteo request', async () => {
  const data = await prepareMoroccoDossierWeather(input, { now: () => now, stations: async () => [{ icao: 'GMMX', name: 'Marrakech', latitude: 31, longitude: -8, products: ['METAR', 'TAF'] }], fetchImpl: async url => {
    assert.equal(url.hostname, 'aviationweather.gov');
    return Response.json(url.pathname.endsWith('taf') ? [taf] : [metar]);
  } });
  assert.equal(data.availabilityReferenceAt, referenceAt);
  assert.equal(data.window.startAt, '2026-11-05T08:00:00.000Z');
  assert.equal(data.window.endAt, '2026-11-05T13:00:00.000Z');
  for (const series of [data.altitudeWind, data.landingGroundWind]) {
    assert.deepEqual(series.points, []);
    assert.equal(series.modelRunAt, null);
    assert.match(series.error, /Disponibilité non attestée/);
  }
  assert.equal(data.aviation.departure.metar.status, 'AVAILABLE');
  assert.equal(data.aviation.landing.metar.status, 'UNAVAILABLE');
  assert.equal(data.aviation.landing.taf.status, 'AVAILABLE');
});

test('Maroc client converts local reference to UTC, preserves flight timestamps, rejects mismatched cutoff', async () => {
  const dossier = { traceId: 'test', model: { providerModelId: 'ecmwf_ifs025' }, startedAt: input.departure.timestamp, launchTimeZone: 'Africa/Casablanca', points: [input.departure, input.landing] };
  const fetchImpl = async (url, init) => {
    assert.equal(url, '/api/preparation/morocco-dossier-weather');
    const body = JSON.parse(init.body);
    assert.equal(body.availabilityReferenceAt, referenceAt);
    assert.equal(body.landing.timestamp, input.landing.timestamp);
    return Response.json({ data: { traceId: 'test', weatherModel: 'ecmwf_ifs025', availabilityReferenceAt: referenceAt } });
  };
  await loadMoroccoFlightDossierWeather(dossier, { date: '2026-11-05', time: '11:00' }, undefined, fetchImpl);
  await assert.rejects(loadMoroccoFlightDossierWeather(dossier, undefined, undefined, async () => Response.json({ data: {} })), /Référence/);
});

test('Maroc route requires an explicit valid UTC reference before any network acquisition', async () => {
  for (const availabilityReferenceAt of [undefined, '2026-11-05T11:00:00+01:00', 'invalid']) {
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ...input, availabilityReferenceAt }) }));
    assert.equal(response.status, 400);
  }
});

test('after-flight dossier searches the flight epoch, not the later document epoch', async () => {
  const result = await load('metar', [metar], { referenceAt: '2026-11-06T10:00:00Z', validAt: referenceAt });
  assert.equal(result.data.metarRaw, metar.rawOb);
  assert.equal((await load('taf', [taf], { referenceAt: '2026-11-06T10:00:00Z', validAt: referenceAt })).data.tafRaw, taf.rawTAF);
});
