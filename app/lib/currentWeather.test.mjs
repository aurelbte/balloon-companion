import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentWeatherSelection, watchCurrentWeather } from './weather/currentWeather.ts';
const points = [8, 9, 10].map(hour => ({ timestamp: `2026-09-18T${String(hour).padStart(2,'0')}:00`, sourceUpdatedAt: '2026-09-18T05:00:00Z', weatherCode: 'CLEAR', model: 'test' }));
const at = time => Date.parse(`2026-09-18T${time}:00Z`);
test('08:10 et passage au créneau suivant, indépendamment de la sélection future', () => {
  assert.equal(currentWeatherSelection(points, 'UTC', at('08:10')).selection.point, points[0]);
  assert.equal(currentWeatherSelection(points, 'UTC', at('08:30')).selection.point, points[1]);
  assert.equal(currentWeatherSelection(points, 'UTC', at('09:10')).selection.point, points[1]);
  assert.equal(currentWeatherSelection(points, 'UTC', at('08:10')).nextAt, at('08:30'));
});
test('aucun fallback éloigné ou fuseau inconnu/invalide', () => {
  assert.equal(currentWeatherSelection(points, 'UTC', at('14:00')).selection.point, null);
  assert.equal(currentWeatherSelection([], 'UTC', at('08:10')).selection.point, null);
  assert.equal(currentWeatherSelection(points, undefined, at('08:10')).selection.point, null);
  assert.equal(currentWeatherSelection(points, 'invalid', at('08:10')).selection.point, null);
});
test('fuseau forecast indépendant de celui de la machine et timestamp explicite', () => {
  assert.equal(currentWeatherSelection(points, 'Europe/Paris', at('06:10')).selection.point, points[0]);
  const zoned = [{ ...points[0], timestamp: '2026-09-18T08:00:00+02:00' }];
  assert.equal(currentWeatherSelection(zoned, undefined, at('06:10')).selection.point, zoned[0]);
});
test('timer ponctuel, reprise, offline et nettoyage des anciens timers', t => {
  let now = at('08:10'), next, delay;
  const windowTarget = new EventTarget(), documentTarget = new EventTarget();
  documentTarget.visibilityState = 'visible'; windowTarget.navigator = { onLine: false };
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => { next = callback; delay = milliseconds; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => { next = undefined; });
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = windowTarget; globalThis.document = documentTarget;
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  let selection;
  const stop = watchCurrentWeather(points, 'UTC', value => { selection = value; });
  assert.equal(selection.point, points[0]); assert.equal(delay, 20 * 60_000);
  now = at('08:30'); next(); assert.equal(selection.point, points[1]);
  now = at('10:10'); documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(selection.point, points[2]);
  now = at('14:00'); windowTarget.dispatchEvent(new Event('focus'));
  assert.equal(selection.point, null); assert.equal(next, undefined);
  now = at('08:10'); windowTarget.dispatchEvent(new Event('focus'));
  const obsoleteTimer = next;
  stop(); obsoleteTimer(); windowTarget.dispatchEvent(new Event('pageshow')); assert.equal(next, undefined);
});
test('UI affiche échéance distincte de récupération et ne consomme pas selectedPoint', () => {
  const card = readFileSync(new URL('../components/cockpit/ConditionsCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /Prévision pour le/); assert.match(card, /currentWeather.validAt/);
  assert.match(card, /cockpitWeatherFreshnessLabel/);
  assert.doesNotMatch(card, /Run du modèle|Récupération météo récente|relativeUpdateLabel/);
  assert.doesNotMatch(card, /selectedPoint/);
});

test('contexte sépare explicitement exploration et sélection automatique', () => {
  const context = readFileSync(new URL('../contexts/WeatherPreferencesContext.tsx', import.meta.url), 'utf8');
  assert.match(context, /currentWeatherSelection\(points, forecastTimeZone, currentClock\)/);
  assert.match(context, /watchCurrentWeather\(points, forecastTimeZone/);
  assert.match(context, /const selectedPoint = points.find/);
  assert.match(context, /currentSunTimes/);
});
