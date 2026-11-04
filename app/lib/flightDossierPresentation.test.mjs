import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHourlyForecast } from './weather/openMeteo/hourlyForecast.ts';
import { dossierLocalTime, dossierWind, dossierWindUnit, dossierArrivalWindWarning } from './flightDossierPresentation.ts';

test('terrain local time follows DST and keeps UTC and offset to distinguish repeated hours', () => {
  const summer = dossierLocalTime('2026-10-25T00:30:00Z', 'Europe/Paris');
  const winter = dossierLocalTime('2026-10-25T01:30:00Z', 'Europe/Paris');
  assert.match(summer, /02:30 UTC\+2/); assert.match(summer, /00:30 UTC/);
  assert.match(winter, /02:30 UTC\+1/); assert.match(winter, /01:30 UTC/);
  assert.match(dossierLocalTime('2026-07-01T23:30:00Z', 'Europe/Paris'), /02\/07\/2026.*01:30/);
  assert.match(dossierLocalTime('2026-07-01T23:30:00Z', 'invalid'), /23:30 UTC$/);
});

test('units convert source speeds consistently; only absent preference defaults', () => {
  assert.equal(dossierWindUnit(), 'km/h'); assert.equal(dossierWindUnit('m/s'), 'm/s');
  assert.throws(() => dossierWindUnit('mph'));
  assert.equal(dossierWind(5, 'm/s', 'km/h'), 18);
  assert.equal(dossierWind(18, 'km/h', 'm/s'), 5);
  assert.ok(Math.abs(dossierWind(18.52, 'km/h', 'kt') - 10) < .001);
  assert.equal(dossierWind(null, 'km/h', 'kt'), null);
});

test('inconsistent raw gusts are flagged without swapping, clamping or inventing values', () => {
  const point = { speedKmh: 5.2, gustKmh: 4.7 };
  assert.match(dossierArrivalWindWarning(point), /valeurs source conservées/);
  assert.deepEqual(point, { speedKmh: 5.2, gustKmh: 4.7 });
  assert.equal(dossierArrivalWindWarning({ speedKmh: 5.2, gustKmh: null }), null);
});


test('Open-Meteo mapping preserves the hourly wind and gust fields at 06 UTC', () => {
  const result = parseHourlyForecast({ latitude: 50.7, longitude: 3.1, hourly: { time: ['2026-11-05T06:00:00Z'], wind_speed_10m: [5.2], wind_gusts_10m: [4.7] } }, 'arome_seamless');
  assert.equal(result.points[0].windSpeedKmh, 5.2);
  assert.equal(result.points[0].windGustKmh, 4.7);
});
