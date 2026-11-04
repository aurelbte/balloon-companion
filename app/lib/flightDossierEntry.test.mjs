import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFlightDossier } from './flightDossierEntry.ts';

const balloon = { id: 'balloon' };
const trace = {
  traceId: 'selected', model: { providerModelId: 'arome', label: 'AROME' },
  projection: { startedAt: '2026-11-04T10:00:00Z', durationSeconds: 60, points: [
    { timestamp: '2026-11-04T10:00:00Z', latitude: 50, longitude: 3, altitudeAmslM: 100 },
    { timestamp: '2026-11-04T10:01:00Z', latitude: 50.01, longitude: 3, altitudeAmslM: 300 },
  ] },
};
test('resolves the explicit trace and preserves its existing data', () => {
  const result = prepareFlightDossier('selected', [{ ...trace, traceId: 'other' }, trace], balloon);
  assert.equal(result.status, 'READY');
  assert.equal(result.data.traceId, 'selected');
  assert.equal(result.data.points, trace.projection.points);
  assert.equal(result.data.model, trace.model);
  assert.equal(result.data.balloon, balloon);
  assert.equal(result.data.landingAt, trace.projection.points[1].timestamp);
  assert.equal(result.data.durationSeconds, 60);
});
test('blocks missing, ambiguous or invalid strategies without substituting another', () => {
  for (const traces of [[], [{ ...trace, traceId: 'other' }], [trace, trace],
    [{ ...trace, projection: { ...trace.projection, points: [] } }],
    [{ ...trace, model: null }],
    [{ ...trace, projection: { ...trace.projection, durationSeconds: 0 } }],
    ...['altitudeAmslM', 'latitude', 'longitude', 'timestamp'].map(field => [{ ...trace, projection: { ...trace.projection, points: [trace.projection.points[0], { ...trace.projection.points[1], [field]: field === 'timestamp' ? 'invalid' : NaN }] } }]),
    [{ ...trace, projection: { ...trace.projection, points: [...trace.projection.points].reverse() } }],
  ]) assert.equal(prepareFlightDossier('selected', traces, balloon).status, 'INVALID');
  assert.equal(prepareFlightDossier('selected', [trace], undefined).status, 'INVALID');
});
