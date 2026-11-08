import test from 'node:test';
import assert from 'node:assert/strict';
import { describePreparationAirspaces } from './preparationAirspaceSummary.ts';
import { selectTrajectoryAirspaces } from './trajectoryAirspaces.ts';
const summary = overrides => describePreparationAirspaces({ count: 0, hasTrajectory: true, hasUsableCoverage: false, coverageStatus: 'PARTIAL', ...overrides });

test('partial, loading, and unavailable coverage never hide already detected potential zones', () => {
  for (const coverageStatus of ['PARTIAL', 'LOADING', 'UNAVAILABLE']) {
    const result = summary({ count: 3, coverageStatus });
    assert.equal(result.value, '3');
    assert.equal(result.label, 'Zones potentielles détectées');
    assert.equal(result.coverageNotice, 'Couverture partielle — liste non exhaustive');
    assert.doesNotMatch(result.label, /confirmée|traversée/);
  }
});

test('no usable data stays unknown, including a misleading complete status or pending tiles', () => {
  for (const coverageStatus of ['COMPLETE', 'PARTIAL', 'LOADING', 'UNAVAILABLE']) {
    const result = summary({ coverageStatus });
    assert.equal(result.value, '?');
    assert.match(result.emptyNotice, /indisponibles/);
    assert.doesNotMatch(result.emptyNotice, /Aucune zone/);
  }
  assert.equal(summary({ count: 3, hasTrajectory: false, hasUsableCoverage: true }).value, '?');
});

test('zero is shown only after usable coverage and a trajectory, and remains qualified for partial coverage', () => {
  const partial = summary({ hasUsableCoverage: true });
  assert.equal(partial.value, '0');
  assert.equal(partial.coverageNotice, 'Couverture partielle — liste non exhaustive');
  const complete = summary({ hasUsableCoverage: true, coverageStatus: 'COMPLETE' });
  assert.equal(complete.value, '0');
  assert.equal(complete.coverageNotice, null);
  assert.match(complete.emptyNotice, /dans les données disponibles/);
});

test('the count consumes the existing trajectory detection and its deduplication', () => {
  const properties = { id: 'zone', airspaceId: 'zone', airspaceCompositeKey: 'zone', name: 'ZONE', lowerLimit: null, upperLimit: null };
  const feature = { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[1,1],[3,1],[3,3],[1,3],[1,1]]] } };
  const trace = { projection: { points: [{longitude:0,latitude:2}, {longitude:4,latitude:2}] } };
  const detected = selectTrajectoryAirspaces(trace, { type: 'FeatureCollection', features: [feature, structuredClone(feature)] });
  assert.equal(detected.length, 1);
  assert.equal(summary({ count: detected.length }).value, '1');
});
