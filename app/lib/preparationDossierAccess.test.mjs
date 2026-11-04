import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Integration wiring: the mobile action must not depend on opening arrival details.
test('PDF action shares the flight action row and retains the existing export flow', () => {
  const page = readFileSync(new URL('../map/page.tsx', import.meta.url), 'utf8');
  const flightAction = page.indexOf('Utiliser cette analyse en Vol');
  const dossierAction = page.indexOf('<FlightDossierAction', flightAction);
  const collapsedSelector = page.indexOf('{legendOpen &&', flightAction);
  assert.ok(flightAction > 0 && dossierAction > flightAction && dossierAction < collapsedSelector);
  const row = page.lastIndexOf('<div className="flex items-stretch gap-2">', flightAction);
  assert.ok(row >= 0 && page.indexOf('</div>', dossierAction) < collapsedSelector);
  assert.match(page, /selectFlightDossierTrace\(displayedTraces, selectedDossierTraceId, exportIds\)/);
  assert.match(page, /aria-label="Actions de l’analyse"/);
  assert.match(page, /h-14 min-w-0 flex-1/);
  assert.match(page, /onSelectedTraceChange=\{setSelectedDossierTraceId\}/);
  assert.match(page, /prepareFlightDossier\(traceId, displayedTraces, selectedBalloon\)/);
  const map = readFileSync(new URL('../components/PreparationMap.tsx', import.meta.url), 'utf8');
  assert.match(map, /onSelectedTraceChange\?\.\(selectedTrace\?\.traceId \?\? null\)/);
  const action = readFileSync(new URL('../components/FlightDossierAction.tsx', import.meta.url), 'utf8');
  assert.match(action, /onFlightDossier\(trace.traceId\)/);
  assert.match(action, /prepared.status !== "READY"/);
  assert.match(action, /disabled=\{dossierPending\}/);
  assert.match(action, /exportFlightDossier\(\{ dossier: prepared.data, weather, weatherError \}/);
  assert.match(action, /role="alert"/);
  assert.match(action, /aria-label="Dossier de vol PDF"/);
  assert.match(action, /<FileDown size=\{18\}/);
  assert.equal([...action.matchAll(/exportFlightDossier\(/g)].length, 1);
  assert.doesNotMatch(action, /useUnitPreferences|windSpeedUnit/);
  assert.match(action, /h-14 w-14 shrink-0/);
});


test('charge always opens a compact temperature panel, including when unavailable', () => {
  const page = readFileSync(new URL('../map/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /const openLoadCard = \(\) => setLoadPanelOpen\(true\)/);
  const panel = page.indexOf('{loadPanelOpen &&');
  assert.ok(panel > 0);
  const form = page.indexOf('<fieldset');
  assert.ok(form > panel);
  assert.equal(page.indexOf('<fieldset', form + 1), -1);
  assert.match(page, /Température effective/);
  assert.match(page, /balloonRegistry.balloons.find\(\(\{ id \}\) => id === selectedBalloonId\)/);
});
