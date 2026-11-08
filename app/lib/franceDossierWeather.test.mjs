import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
import { franceDossierWeatherWindow, franceDossierLandingConditions, createFlightDossierPdf } from './flightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
const map = { png: new Uint8Array(readFileSync(new URL('../../public/branding/balloon-companion-logo-passenger.png', import.meta.url))), background: 'NEUTRAL' };
const textOf = pdf => pdf.getPages().map(page => {
  const streams = page.node.Contents();
  return Array.from({ length: streams.size() }, (_, i) => Buffer.from(decodePDFRawStream(streams.lookup(i)).decode()).toString()).join('\n');
}).join('\n');
const has = (text, value) => text.includes(Buffer.from(value, 'latin1').toString('hex').toUpperCase());

test('France window is departure -1h through departure +duration +1h, across midnight and fractional hours', () => {
  const window = franceDossierWeatherWindow({ startedAt: '2026-11-05T23:30:00Z', durationSeconds: 5400 });
  assert.equal(window.startAt, '2026-11-05T22:30:00.000Z');
  assert.equal(window.landingAt, '2026-11-06T01:00:00.000Z');
  assert.equal(window.endAt, '2026-11-06T02:00:00.000Z');
  assert.deepEqual(window.expectedHours, ['2026-11-05T23:00:00.000Z', '2026-11-06T00:00:00.000Z', '2026-11-06T01:00:00.000Z', '2026-11-06T02:00:00.000Z']);
  assert.equal(window.contains(window.startAt), true);
  assert.equal(window.contains(window.endAt), true);
  assert.equal(window.contains('2026-11-05T22:29:59Z'), false);
  assert.equal(window.contains('2026-11-06T02:00:01Z'), false);
});

test('landing uses final GPS and computed ETA, retaining missing gusts and source metadata', async () => {
  const { dossier, weather } = await dossierPdfFixture();
  dossier.landingAt = '2026-11-05T22:00:00Z'; // Do not trust a stale redundant field.
  const conditions = franceDossierLandingConditions(dossier, weather);
  assert.equal(conditions.landingAt, '2026-11-05T11:00:00.000Z');
  assert.equal(conditions.position, dossier.points.at(-1));
  assert.notEqual(conditions.position.latitude, dossier.points[0].latitude);
  assert.equal(conditions.point.validAt, '2026-11-05T11:00:00.000Z');
  assert.equal(conditions.point.speedKmh, 13);
  assert.equal(conditions.point.directionFromDeg, 242);
  assert.equal(conditions.point.gustKmh, null);
  assert.equal(conditions.ground.fetchedAt, '2026-11-05T08:00:00Z');
  assert.equal(conditions.ground.modelRunAt, null);
  assert.equal(conditions.reason, null);
});

test('no distant hour, departure-location wind, altitude wind, wrong model, or failed ground source substitution', async () => {
  const { dossier, weather } = await dossierPdfFixture();
  const before = structuredClone(weather);
  dossier.durationSeconds = 3900; // ETA 11:05: remove all source hours within 30 minutes.
  weather.landingGroundWind.points = weather.landingGroundWind.points.filter(point => point.validAt !== '2026-11-05T11:00:00.000Z');
  let arrival = franceDossierLandingConditions(dossier, weather);
  assert.equal(arrival.point, null);
  assert.match(arrival.reason, /30 minutes/);
  dossier.durationSeconds = 3600;
  weather.landingGroundWind.requestedLocation = { ...weather.altitudeWind.requestedLocation };
  arrival = franceDossierLandingConditions(dossier, weather);
  assert.equal(arrival.point, null);
  assert.equal(arrival.ground, undefined);
  assert.match(arrival.reason, /autre position/);
  weather.landingGroundWind = before.landingGroundWind;
  weather.weatherModel = 'wrong-model';
  assert.equal(franceDossierLandingConditions(dossier, weather).point, null);
  weather.weatherModel = before.weatherModel;
  weather.landingGroundWind.error = 'SOURCE-INDISPONIBLE';
  assert.equal(franceDossierLandingConditions(dossier, weather).point, null);
  assert.equal(franceDossierLandingConditions(dossier, null).point, null);
});

test('France PDF filters both wind series, preserves real altitude levels and does not mutate shared data', async () => {
  const input = await dossierPdfFixture();
  const before = structuredClone(input);
  for (const point of input.weather.altitudeWind.points) {
    point.levels[0].sourceLevel = ['08', '13'].includes(point.validAt.slice(11, 13)) ? 'EXCLUDED-ALTITUDE' : 'PRESERVED-ALTITUDE';
  }
  for (const point of input.weather.landingGroundWind.points) {
    if (['08', '13'].includes(point.validAt.slice(11, 13))) point.speedKmh = 98765;
  }
  const expected = structuredClone(input);
  const pdf = await PDFDocument.load(await createFlightDossierPdf(input, map));
  const text = textOf(pdf);
  assert.ok(has(text, 'PRESERVED-ALTITUDE'));
  assert.ok(!has(text, 'EXCLUDED-ALTITUDE'));
  assert.ok(!has(text, '98 765'));
  assert.deepEqual(input, expected);
  assert.deepEqual(input.weather.window, before.weather.window); // Shared +/-2h acquisition stays unchanged.
  assert.equal(pdf.getForm().getFields().length, 0);
  for (const value of ['METAR / TAF', 'Charge et', 'Carte -', 'Conditions', 'GPS', 'Non disponible', 'Run du', 'AROME']) assert.ok(has(text, value), value);
  assert.ok(!has(text, 'Checklist'));
  assert.ok(pdf.getPages().at(-1).node.Resources().lookup(PDFName.of("XObject"), PDFDict).keys().length > 0); // Rendered map image retained.
  assert.ok(has(text, 'Rafales au sol'));
  assert.ok(has(text, 'récupération il y a 0 min'));
});

test('PDF shows selected validity and signed offset, and displays genuine gusts only when supplied', async () => {
  const input = await dossierPdfFixture();
  const point = input.weather.landingGroundWind.points.find(point => point.validAt === '2026-11-05T11:00:00.000Z');
  point.gustKmh = 23.4;
  let text = textOf(await PDFDocument.load(await createFlightDossierPdf(input, map)));
  assert.ok(has(text, '23,4'));
  input.dossier.durationSeconds = 3900;
  text = textOf(await PDFDocument.load(await createFlightDossierPdf(input, map)));
  assert.ok(has(text, 'Non disponible'));
  assert.ok(has(text, '-5 min (validité - arrivée)'));
  assert.ok(has(text, '05/11 12:00 UTC+1 (05/11 11:00 UTC)'));
  input.weather.landingGroundWind.points = [];
  text = textOf(await PDFDocument.load(await createFlightDossierPdf(input, map)));
  assert.ok(has(text, 'Aucune prévision au sol disponible'));
  assert.ok(has(text, 'Non disponible'));
  const none = { ...input, weather: null, weatherError: 'HORS-LIGNE' };
  text = textOf(await PDFDocument.load(await createFlightDossierPdf(none, map)));
  assert.ok(has(text, 'HORS-LIGNE'));
  assert.ok(has(text, 'Prévisions géolocalisées au sol absentes.'));
});


test('nearest landing forecast includes both 30-minute bounds, rejects beyond, and resolves ties to the earlier hour', async () => {
  const { dossier, weather } = await dossierPdfFixture();
  const original = weather.landingGroundWind.points.find(point => point.validAt === '2026-11-05T11:00:00.000Z');
  const at = validAt => ({ ...original, validAt });
  for (const [validAt, expected] of [
    ['2026-11-05T10:30:00Z', -30], ['2026-11-05T11:30:00Z', 30],
    ['2026-11-05T10:29:59Z', null], ['2026-11-05T11:30:01Z', null],
    ['2026-11-05T11:00:00Z', 0],
  ]) {
    weather.landingGroundWind.points = [at(validAt)];
    const arrival = franceDossierLandingConditions(dossier, weather);
    assert.equal(arrival.offsetMinutes, expected);
    assert.equal(Boolean(arrival.point), expected !== null);
  }
  dossier.durationSeconds = 5400; // ETA 11:30, equal distance from 11:00 and 12:00.
  weather.landingGroundWind.points = [at('2026-11-05T12:00:00Z'), at('2026-11-05T11:00:00Z')];
  assert.equal(franceDossierLandingConditions(dossier, weather).point.validAt, '2026-11-05T11:00:00Z');
  dossier.durationSeconds = 5700; // ETA 11:35: the next hour is closer.
  const before = structuredClone(weather);
  const arrival = franceDossierLandingConditions(dossier, weather);
  assert.equal(arrival.point.validAt, '2026-11-05T12:00:00Z');
  assert.equal(arrival.offsetMinutes, 25);
  assert.deepEqual(weather, before);
});

test('wind and gusts stay at one selected ground hour, with no borrowing to fill missing values', async () => {
  const { dossier, weather } = await dossierPdfFixture();
  dossier.durationSeconds = 5400;
  const previous = weather.landingGroundWind.points.find(point => point.validAt === '2026-11-05T11:00:00.000Z');
  const next = weather.landingGroundWind.points.find(point => point.validAt === '2026-11-05T12:00:00.000Z');
  assert.equal(previous.gustKmh, null);
  assert.ok(next.gustKmh > 0);
  const arrival = franceDossierLandingConditions(dossier, weather);
  assert.equal(arrival.point, previous);
  assert.equal(arrival.point.speedKmh, previous.speedKmh);
  assert.equal(arrival.point.gustKmh, null);
  weather.landingGroundWind.points = [{ ...previous, speedKmh: null, gustKmh: null, directionFromDeg: null }];
  assert.equal(franceDossierLandingConditions(dossier, weather).point, null);
});
