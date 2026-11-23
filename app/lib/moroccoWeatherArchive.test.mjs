import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { moroccoCalculationIdentity, archiveMoroccoCalculation } from './moroccoCalculationArchive.ts';
import { createMoroccoWeatherArchive, latestMoroccoWeatherArchive, inspectMoroccoWeatherArchives, moroccoWeatherMatchKey, IndexedDbMoroccoWeatherArchive } from './moroccoWeatherArchive.ts';
import { loadMoroccoDossierPreparation } from './moroccoPreparationClient.ts';
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive, getRuntimeDataScopeGeneration } from './auth/dataScopeRuntime.ts';
import { POST as retiredCapture } from '../api/preparation/morocco-weather-capture/route.ts';
const receivedAt = '2026-11-05T08:01:00.000Z', storedAt = '2026-11-05T08:01:01.000Z';
const memory = () => { const rows = new Map(); return { rows, async saveOnce(value) { if (!rows.has(value.id)) rows.set(value.id, structuredClone({ ...value, storedAt })); }, async matching(key) { return structuredClone([...rows.values()].filter(row => row.matchKey === key)); } }; };
async function fixture() {
  const { dossier } = await dossierPdfFixture();
  const first = dossier.points[0];
  const request = { version: 2, launchSite: { name: dossier.launchSiteName, latitude: first.latitude, longitude: first.longitude }, launchTimeZone: dossier.launchTimeZone,
    launchDateTimeIso: dossier.startedAt, durationSeconds: dossier.durationSeconds, weatherModel: dossier.model.providerModelId, altitudesAmslM: [600], primaryAltitudeAmslM: 600, climbRateMps: 2, descentRateMps: 2 };
  const trajectory = { traceId: dossier.traceId, label: dossier.strategyLabel, altitudeKey: '600', altitudeAmslM: 600, model: dossier.model,
    weatherFetchedAt: '2026-11-05T08:00:00Z', calculatedAtIso: '2026-11-05T07:59:30Z', modelRunAt: null,
    projection: { points: dossier.points, startedAt: dossier.startedAt, durationSeconds: dossier.durationSeconds } };
  const raw = { source: 'Open-Meteo', endpoint: 'https://api.open-meteo.com/v1/forecast', kind: 'calculation', model: request.weatherModel, query: { latitude: first.latitude, longitude: first.longitude, validAt: request.launchDateTimeIso, weatherModel: request.weatherModel }, receivedAt: trajectory.weatherFetchedAt,
    payload: { latitude: first.latitude, longitude: first.longitude, elevation: 47, generationtime_ms: 12, hourly_units: { wind_speed_80m: 'm/s', wind_direction_80m: '°' }, hourly: { time: ['2026-11-05T09:00','2026-11-05T10:00','2026-11-05T11:00','2026-11-05T12:00'], wind_speed_80m: [4,5,6,7], wind_direction_80m: [240,250,260,270] } } };
  const payload = { ok: true, terrainAltitudeAmslM: 47, moroccoCalculation: { request, rawForecasts: [raw] } };
  trajectory.moroccoPreparationIdentity = moroccoCalculationIdentity(request, trajectory, 47);
  dossier.moroccoPreparationIdentity = trajectory.moroccoPreparationIdentity;
  const store = memory(); await archiveMoroccoCalculation(payload, trajectory, receivedAt, store);
  const record = [...store.rows.values()][0];
  return { dossier, trajectory, request, payload, store, record };
}

test('archive diagnostics distinguish missing, late, incompatible and invalid evidence without changing selection', async () => {
  const { dossier, record } = await fixture();
  const cutoff = '2026-11-05T08:30:00Z';
  assert.match(inspectMoroccoWeatherArchives([], dossier, cutoff).notice, /Aucune archive locale trouvée/);
  const late = { ...record, storedAt: '2026-11-05T09:00:00Z' };
  assert.match(inspectMoroccoWeatherArchives([late], dossier, cutoff).notice, /postérieur.*09:00:00Z/);
  const wrong = structuredClone(record); wrong.dossier.points.at(-1).longitude += .01;
  assert.match(inspectMoroccoWeatherArchives([wrong], dossier, cutoff).notice, /trajectoire différente/);
  const invalid = { ...record, receivedAt: '2026-11-05T09:00:00Z' };
  assert.match(inspectMoroccoWeatherArchives([invalid], dossier, cutoff).notice, /Horodatages UTC/);
  assert.equal(inspectMoroccoWeatherArchives([late, record], dossier, cutoff).archive.id, record.id);
});

test('ECMWF synthetic November 23 case reuses captured future-valid forecasts at 06:30 UTC, even when exporting later', async () => {
  const { dossier, trajectory, payload } = await fixture();
  // Synthetic fixture verifies availability guards, not actual weather on this date.
  const shift = value => value.replace('2026-11-05', '2026-11-23');
  dossier.startedAt = shift(dossier.startedAt); dossier.landingAt = shift(dossier.landingAt);
  dossier.points.forEach(point => point.timestamp = shift(point.timestamp));
  dossier.model = { ...dossier.model, providerModelId: 'ecmwf_ifs025', label: 'ECMWF IFS025' };
  trajectory.model = dossier.model;
  trajectory.projection = { ...trajectory.projection, points: dossier.points, startedAt: dossier.startedAt };
  trajectory.calculatedAtIso = '2026-11-23T06:00:00Z'; trajectory.weatherFetchedAt = '2026-11-23T06:01:00Z';
  const evidence = payload.moroccoCalculation;
  evidence.request.launchDateTimeIso = dossier.startedAt; evidence.request.weatherModel = 'ecmwf_ifs025';
  const raw = evidence.rawForecasts[0]; raw.model = 'ecmwf_ifs025'; raw.query.weatherModel = raw.model;
  raw.query.validAt = dossier.startedAt; raw.receivedAt = trajectory.weatherFetchedAt;
  raw.payload.hourly.time = raw.payload.hourly.time.map(shift);
  trajectory.moroccoPreparationIdentity = moroccoCalculationIdentity(evidence.request, trajectory, 47);
  dossier.moroccoPreparationIdentity = trajectory.moroccoPreparationIdentity;
  let record;
  const store = { async saveOnce(value) { record = { ...value, storedAt: '2026-11-23T06:02:00Z' }; }, async matching() { return [record]; } };
  await archiveMoroccoCalculation(payload, trajectory, '2026-11-23T06:01:01Z', store);
  const reference = { date: '2026-11-23', time: '07:30' }; // Europe/Paris, UTC 06:30.
  const exported = await loadMoroccoDossierPreparation(dossier, reference, undefined, { store, fetchImpl: async () => { throw new Error('No current weather fetch allowed'); } });
  assert.equal(exported.weather.weatherModel, 'ecmwf_ifs025');
  assert.ok(exported.weather.altitudeWind.points.length > 0);
  assert.ok(exported.weather.altitudeWind.points.every(point => Date.parse(point.validAt) > Date.parse('2026-11-23T06:30:00Z')));
  assert.equal(exported.weather.landingGroundWind.status, 'UNAVAILABLE');
  assert.equal(exported.weather.altitudeWind.modelRunAt, null);
  assert.equal(inspectMoroccoWeatherArchives([{ ...record, storedAt: '2026-11-23T06:31:00Z' }], dossier, '2026-11-23T06:30:00Z').archive, null);
});

test('calculation archive preserves exact raw body and partial statuses with no network or balloon/PDF prerequisite', async () => {
  const { record, payload } = await fixture();
  assert.deepEqual(record.rawForecasts, payload.moroccoCalculation.rawForecasts);
  assert.equal(record.completeness, 'PARTIAL');
  assert.equal(record.dossier.balloon, undefined);
  assert.equal(record.weather.aviation.departure.metar.status, 'UNAVAILABLE');
  assert.equal(record.weather.landingGroundWind.status, 'UNAVAILABLE');
  assert.match(record.weather.landingGroundWind.error, /départ n’est pas substitué/);
  assert.equal(record.weather.altitudeWind.points[1].levels[0].windSpeedMps, 5);
  assert.equal(record.weather.altitudeWind.modelRunAt, null);
  assert.match(record.weather.notices.join(' '), /Run non communiqué/);
  assert.match(record.weather.notices.join(' '), /partielle/);
  payload.moroccoCalculation.rawForecasts[0].payload.hourly.wind_speed_80m[0] = 999;
  assert.equal(record.rawForecasts[0].payload.hourly.wind_speed_80m[0], 4);
});

test('departure and arrival winds archive exact raw data, units, grid and independent reception; delayed export performs no fetch', async () => {
  const { dossier, trajectory, payload } = await fixture();
  const last = dossier.points.at(-1);
  const arrival = { source: 'Open-Meteo', endpoint: 'https://api.open-meteo.com/v1/forecast', kind: 'ground', model: dossier.model.providerModelId,
    query: { latitude: last.latitude, longitude: last.longitude, landingAt: last.timestamp }, receivedAt: '2026-11-05T08:00:30Z',
    payload: { latitude: last.latitude + .001, longitude: last.longitude + .001, utc_offset_seconds: 0,
      hourly_units: { wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' },
      hourly: { time: ['2026-11-05T10:00', '2026-11-05T11:00'], wind_speed_10m: [12, 14], wind_direction_10m: [260, 270], wind_gusts_10m: [18, null] } } };
  payload.moroccoCalculation.rawForecasts.push(arrival);
  const store = memory(); await archiveMoroccoCalculation(payload, trajectory, receivedAt, store);
  const record = [...store.rows.values()][0];
  assert.deepEqual(record.rawForecasts[1], arrival);
  assert.equal(record.weather.altitudeWind.points[1].levels[0].windSpeedMps, 5);
  const result = await loadMoroccoDossierPreparation(dossier, { date: '2026-11-05', time: '09:30' }, undefined, { store, fetchImpl: async () => { throw new Error('No export fetch'); } });
  const ground = result.weather.landingGroundWind;
  assert.deepEqual(ground.requestedLocation, { latitude: last.latitude, longitude: last.longitude });
  assert.deepEqual(ground.sourceLocation, { latitude: arrival.payload.latitude, longitude: arrival.payload.longitude });
  assert.equal(ground.fetchedAt, arrival.receivedAt); assert.equal(ground.modelRunAt, null);
  assert.deepEqual(ground.points.map(p => [p.speedKmh, p.directionFromDeg, p.gustKmh]), [[12, 260, 18], [14, 270, null]]);
  assert.equal(ground.status, 'PARTIAL'); // Missing gust and hours remain explicit; aviation also remains missing.
  const late = structuredClone(payload);
  late.moroccoCalculation.rawForecasts[1].receivedAt = '2026-11-05T09:00:00Z';
  let lateRecord;
  await archiveMoroccoCalculation(late, trajectory, '2026-11-05T09:00:01Z', { async saveOnce(value) { lateRecord = { ...value, storedAt: '2026-11-05T09:00:02Z' }; }, async matching() { return []; } });
  assert.equal(latestMoroccoWeatherArchive([lateRecord], dossier, '2026-11-05T08:30:00Z'), null);
  assert.equal(latestMoroccoWeatherArchive([lateRecord], dossier, '2026-11-05T09:30:00Z').id, lateRecord.id);
  for (const mutate of [r => r.query.latitude += .01, r => r.query.landingAt = '2026-11-05T12:00:00Z', r => r.payload.utc_offset_seconds = 3600, r => r.payload.hourly_units.wind_speed_10m = 'm/s']) {
    const other = structuredClone(payload); mutate(other.moroccoCalculation.rawForecasts[1]);
    const s = memory(); await archiveMoroccoCalculation(other, trajectory, receivedAt, s);
    const rejected = [...s.rows.values()][0].weather;
    assert.equal(rejected.landingGroundWind.status, 'UNAVAILABLE');
    assert.ok(rejected.altitudeWind.points.length);
  }
});

test('immediate export waits for the existing archive commit; write failure is explicit and never triggers current weather', async () => {
  const { dossier, trajectory, payload } = await fixture();
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const store = memory(), original = store.saveOnce;
  store.saveOnce = async value => { entered(); await waiting; await original(value); };
  const write = archiveMoroccoCalculation(payload, trajectory, receivedAt, store);
  await started;
  let matched = false; const matching = store.matching;
  store.matching = async key => { matched = true; return matching(key); };
  const exported = loadMoroccoDossierPreparation(dossier, { date: '2026-11-05', time: '09:30' }, undefined, { store, fetchImpl: async () => { throw new Error('Unexpected forecast'); } });
  await Promise.resolve(); assert.equal(matched, false);
  release(); await write; assert.ok((await exported).weather.altitudeWind.points.length);

  let fail, badEntered;
  const failed = new Promise((_, reject) => { fail = reject; });
  const badStarted = new Promise(resolve => { badEntered = resolve; });
  const badStore = { saveOnce: () => { badEntered(); return failed; }, matching: async () => [] };
  const badWrite = archiveMoroccoCalculation(payload, trajectory, receivedAt, badStore);
  const caught = assert.rejects(badWrite, /Quota dépassé/);
  await badStarted;
  const fallback = loadMoroccoDossierPreparation(dossier, { date: '2026-11-05', time: '09:30' }, undefined, { store: badStore, fetchImpl: async (url, init) => {
    assert.equal(url, '/api/preparation/morocco-dossier-weather');
    const body = JSON.parse(init.body);
    return Response.json({ data: { traceId: dossier.traceId, weatherModel: dossier.model.providerModelId, availabilityReferenceAt: body.availabilityReferenceAt, notices: [] } });
  } });
  fail(new Error('Quota dépassé')); await caught;
  assert.match((await fallback).weather.notices[0], /Quota dépassé/);
});

test('identity includes every request parameter, effective terrain and selected altitude, including climb/descent/profile parameters', async () => {
  const { trajectory, request } = await fixture();
  const identity = moroccoCalculationIdentity(request, trajectory, 47);
  for (const change of [r => r.climbRateMps = 3, r => r.descentRateMps = 3, r => r.primaryAltitudeAmslM = 700,
    r => r.altitudesAmslM = [600, 900], r => r.durationSeconds += 60, r => r.launchDateTimeIso = '2026-11-06T10:00:00Z',
    r => r.launchSite.latitude += .001, r => r.launchSite.longitude += .001, r => r.weatherModel = 'ecmwf_ifs025']) {
    const changed = structuredClone(request); change(changed);
    assert.notEqual(moroccoCalculationIdentity(changed, trajectory, 47), identity);
  }
  assert.notEqual(moroccoCalculationIdentity(request, trajectory, 50), identity);
  assert.notEqual(moroccoCalculationIdentity(request, { ...trajectory, altitudeAmslM: 700 }, 47), identity);
});

test('export rejects same traceId with different calculation identity OR different trajectory; legacy archives are refused', async () => {
  const { dossier, trajectory, request, record } = await fixture();
  const cutoff = '2026-11-05T08:30:00Z';
  assert.equal(latestMoroccoWeatherArchive([record], dossier, cutoff).id, record.id);
  const different = structuredClone(dossier);
  different.moroccoPreparationIdentity = moroccoCalculationIdentity({ ...request, climbRateMps: 3 }, trajectory, 47);
  assert.equal(latestMoroccoWeatherArchive([record], different, cutoff), null);
  const geometry = structuredClone(dossier); geometry.points.at(-1).longitude += .01;
  assert.equal(latestMoroccoWeatherArchive([record], geometry, cutoff), null);
  assert.equal(latestMoroccoWeatherArchive([{ ...record, version: 1 }], dossier, cutoff), null);
  assert.throws(() => moroccoWeatherMatchKey({ ...dossier, moroccoPreparationIdentity: undefined }), /Identité complète/);
});

test('UTC cutoff checks each reception and committed storage, not forecast validity; newest admissible version wins', async () => {
  const { dossier, record } = await fixture();
  const later = { ...record, id: 'later', storedAt: '2026-11-05T09:00:00Z' };
  assert.equal(latestMoroccoWeatherArchive([record, later], dossier, '2026-11-05T08:30:00Z').id, record.id);
  assert.equal(latestMoroccoWeatherArchive([record, later], dossier, '2026-11-05T09:00:00Z').id, 'later');
  assert.equal(latestMoroccoWeatherArchive([record], dossier, receivedAt), null);
  for (const mutate of [v => v.receivedAt = '2026-11-05T09:00:00Z', v => v.rawForecasts[0].receivedAt = '2026-11-05T09:00:00Z', v => v.trajectory.weatherFetchedAt = '2026-11-05T09:00:00Z']) {
    const bad = structuredClone(record); mutate(bad);
    assert.equal(latestMoroccoWeatherArchive([bad], dossier, '2026-11-05T08:30:00Z'), null);
  }
  assert.equal(latestMoroccoWeatherArchive([{}, record], dossier, '2026-11-05T08:30:00Z').id, record.id);
});

test('duplicate bodies keep first version; raw changes add versions; missing or divergent provenance is rejected', async () => {
  const { dossier, trajectory, record } = await fixture();
  const capture = { weather: record.weather, rawForecasts: record.rawForecasts, calculationRequest: record.calculationRequest, calculationFailures: record.calculationFailures };
  const duplicate = structuredClone(capture); duplicate.rawForecasts[0].payload.generationtime_ms = 99;
  assert.equal((await createMoroccoWeatherArchive(record.dossier, trajectory, duplicate, receivedAt)).id, record.id);
  duplicate.rawForecasts[0].payload.hourly.wind_speed_80m[0] = 10;
  assert.notEqual((await createMoroccoWeatherArchive(record.dossier, trajectory, duplicate, receivedAt)).id, record.id);
  await assert.rejects(createMoroccoWeatherArchive(dossier, { ...trajectory, weatherFetchedAt: undefined }, capture, receivedAt), /Horodatages/);
  await assert.rejects(createMoroccoWeatherArchive(dossier, trajectory, { ...capture, rawForecasts: [] }, receivedAt), /Horodatages/);
  await assert.rejects(createMoroccoWeatherArchive(dossier, trajectory, { ...capture, rawForecasts: [{ ...record.rawForecasts[0], kind: 'ground' }] }, receivedAt), /Horodatages/);
});

test('offline export uses exact saved calculation while preserving current non-weather data; mismatch uses historical-only fallback', async () => {
  const { dossier, store } = await fixture();
  const result = await loadMoroccoDossierPreparation(dossier, { date: '2026-11-05', time: '09:30' }, undefined, { store, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(result.dossier.points, dossier.points);
  assert.deepEqual(result.dossier.balloon, dossier.balloon);
  assert.deepEqual(result.dossier.operations, dossier.operations);
  assert.match(result.weather.notices[0], /Préparation locale immuable/);
  const mismatch = { ...dossier, moroccoPreparationIdentity: 'different' };
  const fallback = await loadMoroccoDossierPreparation(mismatch, { date: '2026-11-05', time: '09:30' }, undefined, { store, fetchImpl: async (url, init) => {
    assert.equal(url, '/api/preparation/morocco-dossier-weather');
    const body = JSON.parse(init.body);
    return Response.json({ data: { traceId: dossier.traceId, weatherModel: dossier.model.providerModelId, availabilityReferenceAt: body.availabilityReferenceAt, notices: [] } });
  } });
  assert.match(fallback.weather.notices[0], /Historique fournisseur uniquement/);
});

test('map archives every new calculated trace outside PDF mounting; old current-capture endpoint is disabled', async () => {
  const map = readFileSync(new URL('../map/page.tsx', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../components/FlightDossierAction.tsx', import.meta.url), 'utf8');
  assert.match(map, /moroccoCalculationAcquisitionOptions\(readMoroccoPreparationIntent\(config.request\)\)/);
  assert.match(map, /for \(const trace of nextTraces.filter/);
  assert.ok(map.indexOf('archiveMoroccoCalculation(result.payload') < map.indexOf('const dossierTrace ='));
  assert.doesNotMatch(action, /saveLoadedMoroccoPreparation|archiveMoroccoCalculation/);
  assert.equal((await retiredCapture()).status, 410);
});
// Transactional IndexedDB double: serialised readwrite transactions, rollback, durable reopening.
function factory() {
  const databases = new Map(), names = [];
  let abortNext = false;
  return { databases, names, failNext: () => { abortNext = true; }, open(name) {
    names.push(name); const req = {};
    queueMicrotask(() => {
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, { stores: new Map(), queue: [], busy: false });
      const data = databases.get(name);
      req.result = { close() {}, createObjectStore(store) { data.stores.set(store, new Map()); return { createIndex() {} }; }, transaction(names, mode) {
        const operations = []; let working, failed = false;
        const tx = { error: null, objectStore(name) {
          const request = fn => { const r = {}; operations.push(() => { try { r.result = fn(working.get(name)); r.onsuccess?.(); } catch(e) { failed = true; tx.error = e; } }); return r; };
          return {
            get: key => request(store => structuredClone(store.get(key))),
            add: value => request(store => { if (store.has(value.id)) throw new Error('duplicate key'); store.set(value.id, structuredClone(value)); }),
            index: () => ({ getAll: key => request(store => structuredClone([...store.values()].filter(row => row.matchKey === key))) }),
          };
        } };
        data.queue.push(() => {
          working = structuredClone(data.stores);
          const abort = mode === 'readwrite' && abortNext; if (abort) abortNext = false;
          const step = () => {
            if (!failed && operations.length) { operations.shift()(); queueMicrotask(step); return; }
            if (failed || abort) { tx.error ??= new Error('transaction aborted'); tx.onabort?.(); }
            else { if (mode === 'readwrite') data.stores = working; tx.oncomplete?.(); }
            data.busy = false; start();
          }; queueMicrotask(step);
        });
        function start() { if (!data.busy && data.queue.length) { data.busy = true; data.queue.shift()(); } }
        queueMicrotask(start); return tx;
      } };
      if (fresh) req.onupgradeneeded?.(); req.onsuccess?.();
    }); return req;
  } };
}

function guest() { setRuntimeAuthSnapshot({ state: 'SIGNED_OUT', user: null }); setRuntimeGuestModeActive(true); }
test('IndexedDB versions persist across instances, concurrent duplicates preserve first receipt, failed commits are not available', async () => {
  guest(); const f = factory(), { record } = await fixture();
  const store = new IndexedDbMoroccoWeatherArchive('GUEST', getRuntimeDataScopeGeneration(), f);
  await Promise.all([store.saveOnce(record), store.saveOnce(record)]);
  const read = new IndexedDbMoroccoWeatherArchive('GUEST', getRuntimeDataScopeGeneration(), f);
  assert.equal((await read.matching(record.matchKey)).length, 1);
  const first = (await read.matching(record.matchKey))[0];
  await store.saveOnce({ ...record, receivedAt: '2026-11-05T08:10:00Z' });
  assert.equal((await read.matching(record.matchKey))[0].storedAt, first.storedAt);
  f.failNext(); await assert.rejects(store.saveOnce({ ...record, id: 'failed' }), /aborted/);
  assert.equal((await read.matching(record.matchKey)).length, 1);
  setRuntimeAuthSnapshot({ state: 'SIGNED_IN', user: { id: 'another-user' } });
  await assert.rejects(store.matching(record.matchKey), /Compte local modifié/);
  const other = new IndexedDbMoroccoWeatherArchive('USER:another-user', getRuntimeDataScopeGeneration(), f);
  assert.equal((await other.matching(record.matchKey)).length, 0);
  guest();
});

test('partial calculation failures are retained verbatim and visible in archive notices', async () => {
  const { payload, trajectory } = await fixture(), store = memory();
  payload.failures = [{ altitudeKey: 'profile', code: 'INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE', message: 'Profil vertical impossible avec cette durée.' }];
  await archiveMoroccoCalculation(payload, trajectory, receivedAt, store);
  const record = [...store.rows.values()][0];
  assert.deepEqual(record.calculationFailures, payload.failures);
  assert.deepEqual(record.calculationRequest, payload.moroccoCalculation.request);
  assert.match(record.weather.notices.join(' '), /INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE/);
});
