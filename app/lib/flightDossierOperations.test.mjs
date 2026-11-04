import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDossierLoad, prepareDossierAirspaces, prepareFlightDossierOperations } from './flightDossierOperations.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { openAipAirspacesToGeoJson } from './openaip.ts';

const balloon = { id: 'selected-balloon', registration: 'F-TEST', manufacturer: 'Cameron', model: 'Z105', volumeM3: 2974, configurationLimitsConfirmed: true, applicableMtowKg: 952, weights: { envelopeKg: 100, basketKg: 150, burnerKg: 50, fullCylinders: [] }, documents: [] };
const loadInput = buildLoadCalculationInput({ balloon, occupantsWeightKg: 200, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 1000, groundTemperature: { temperatureC: 10, sourceModel: 'arome_seamless', forecastRun: '', validTime: '2026-11-05T10:00:00Z' } });
const at = (x, altitude, seconds) => ({ longitude: x, latitude: 0, altitudeAmslM: altitude, elapsedSeconds: seconds, timestamp: new Date(Date.parse('2026-11-05T10:00:00Z') + seconds * 1000).toISOString(), verticalPhase: 'climb' });
const points = [at(0, 0, 0), at(10, 1000, 100)];
const limit = value => ({ value, unit: 0, referenceDatum: 1 });
const box = (from, to) => [[from,-1],[to,-1],[to,1],[from,1],[from,-1]];
function feature(id, lower = limit(150), upper = limit(180), geometry = { type: 'Polygon', coordinates: [box(1,2)] }) {
  return { type: 'Feature', geometry, properties: { id, airspaceId: id, airspaceCompositeKey: id, name: id, type: 4, typeLabel: 'CTR', icaoClass: 3, icaoClassLabel: 'D', lowerLimit: lower, upperLimit: upper, lowerLimitMin: null, upperLimitMax: null, frequencies: [{ value: '120.000', unit: 2 }], activity: null, onDemand: null, onRequest: null, byNotam: null, activeFrom: null, activeUntil: null, country: 'FR', remarks: null } };
}
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('load data delegates to the existing engine, preserving candidate status and signed margins', () => {
  for (const occupantsWeightKg of [200, 1200]) {
    const input = { ...loadInput, occupantsWeightKg };
    const expected = calculateOfficialLoad(input);
    const result = prepareDossierLoad(balloon, input);
    assert.equal(expected.status, 'AVAILABLE');
    assert.equal(result.calculationStatus, 'CANDIDATE_PILOT_VALIDATION');
    for (const field of ['actualTotalMassKg', 'permittedTotalMassKg', 'marginKg', 'limitingRule', 'datasetId']) assert.equal(result.result[field], expected[field]);
    assert.equal(result.plannedMassKg, expected.actualTotalMassKg);
    assert.equal(result.applicableLimitKg, expected.permittedTotalMassKg);
    assert.equal(result.marginKg, expected.marginKg);
    assert.match(result.signedMarginKg, occupantsWeightKg === 200 ? /^\+/ : /^−/);
    assert.equal(result.curve.status, 'UNAVAILABLE');
    assert.equal(result.curve.points, null);
  }
});

test('missing inputs and unconfirmed limits never create a limit or margin; known mass remains available', () => {
  const input = { ...loadInput, configurationLimitsConfirmed: false };
  const result = prepareDossierLoad(balloon, input);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.unavailableReason, 'CONFIGURATION_LIMITS_UNCONFIRMED');
  assert.equal(result.applicableLimitKg, null);
  assert.equal(result.marginKg, null);
  assert.equal(result.plannedMassKg, 500);
  assert.equal(prepareDossierLoad(balloon, { ...loadInput, balloonEquipmentWeightKg: undefined }).plannedMassKg, null);
});

test('demo/synthetic input, mismatched balloon and underestimated flight altitude are blocked', () => {
  for (const result of [prepareDossierLoad(balloon, loadInput, true), prepareDossierLoad(balloon, { ...loadInput, groundTemperature: { ...loadInput.groundTemperature, sourceModel: 'DEMO' } })]) {
    assert.equal(result.unavailableReason, 'DEMO_DATA_EXCLUDED');
    assert.equal(result.result, null);
    assert.equal(result.plannedMassKg, null);
    assert.equal(result.curve.points, null);
  }
  assert.equal(prepareDossierLoad(balloon, { ...loadInput, balloonId: 'other' }).unavailableReason, 'BALLOON_INPUT_MISMATCH');
  const result = prepareFlightDossierOperations({ traceId: 'chosen', balloon, points }, { ...loadInput, plannedMaximumAltitudeMslM: 500 }, collection());
  assert.equal(result.traceId, 'chosen');
  assert.equal(result.load.unavailableReason, 'TRACE_EXCEEDS_LOAD_ALTITUDE');
  assert.equal(result.load.marginKg, null);
  assert.equal(result.load.applicableLimitKg, null);
});

test('existing Kubicek source chart is exposed with original units and provenance, without activating its calculation', () => {
  const selected = { ...balloon, manufacturer: 'Kubíček', model: 'BB26', volumeM3: 2600 };
  const input = buildLoadCalculationInput({ balloon: selected, occupantsWeightKg: 200, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 1000, groundTemperature: loadInput.groundTemperature });
  const result = prepareDossierLoad(selected, input);
  assert.equal(result.status, 'UNAVAILABLE'); // Same production engine; no activation added.
  assert.equal(result.curve.status, 'SOURCE_DATA_AVAILABLE');
  assert.equal(result.curve.points.length, 713);
  assert.equal(result.curve.points[0].altitudeMslFt, 0);
  assert.equal(result.curve.units.ordinate, 'Lift Units');
  assert.equal(result.curve.usedByCalculation, false);
  assert.equal(result.curve.verificationStatus, 'CANDIDATE_PILOT_VALIDATION');
  assert.match(result.curve.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.applicableLimitKg, null);
});

test('horizontal AND vertical intersection are simultaneous, not based on whole-segment mean altitude', () => {
  const data = prepareDossierAirspaces(points, collection(feature('crossed'), feature('outside-altitude', limit(450), limit(550)), feature('entirely-above', limit(2000), limit(3000))));
  assert.deepEqual(data.uncertain.map(item => item.airspace.name), ['crossed']);
  const crossing = data.uncertain[0];
  assert.equal(crossing.spatialStatus, 'INTERSECTS_3D');
  assert.equal(crossing.passages[0].entryAt, '2026-11-05T10:00:15.000Z');
  assert.equal(crossing.passages[0].exitAt, '2026-11-05T10:00:18.000Z');
  assert.equal(crossing.passages[0].entryAltitudeAmslM, 150);
  assert.equal(crossing.passages[0].exitAltitudeAmslM, 180);
  assert.equal(crossing.airspace.icaoClassLabel, 'D');
  assert.equal(crossing.status, 'UNCERTAIN'); // Geometry known, activity not proven.
  assert.equal(data.confirmed.length, 0);
});

test('descending segment clips in the correct order and converts feet AMSL', () => {
  const data = prepareDossierAirspaces([at(0,1000,0),at(10,0,100)], collection(feature('descent', { value: 2600, unit: 1, referenceDatum: 1 }, { value: 2900, unit: 1, referenceDatum: 1 })));
  const passage = data.uncertain[0].passages[0];
  assert.ok(Math.abs(passage.entryAltitudeAmslM - 883.92) < 1e-6);
  assert.ok(Math.abs(passage.exitAltitudeAmslM - 800) < 1e-6);
  assert.equal(data.uncertain[0].spatialStatus, 'INTERSECTS_3D');
});

test('AGL, SFC, FL and unknown datums remain uncertain without invented terrain or QNH', () => {
  const limits = [{ value: 10, unit: 0, referenceDatum: 0 }, { value: 0, unit: 0, referenceDatum: 0 }, { value: 5, unit: 6, referenceDatum: 2 }, null];
  for (const floor of limits) {
    const data = prepareDossierAirspaces(points, collection(feature('uncertain', floor, limit(1000))));
    assert.equal(data.uncertain[0].spatialStatus, 'UNCERTAIN');
    assert.ok(data.uncertain[0].passages[0].reasons.length);
    assert.equal(data.confirmed.length, 0);
  }
  // A known ceiling can still prove absence, even with an unknown floor.
  assert.equal(prepareDossierAirspaces(points, collection(feature('below', limits[0], limit(50)))).uncertain.length, 0);
});

test('holes and MultiPolygon preserve separate passage windows; duplicates do not duplicate airspaces', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[box(1,9), box(4,6)], [box(12,13)]] };
  const zone = feature('with-hole', limit(100), limit(900), geometry);
  const data = prepareDossierAirspaces([at(0,500,0),at(10,500,100)], collection(zone, zone));
  assert.equal(data.uncertain.length, 1);
  const intervals = data.uncertain[0].passages;
  assert.equal(intervals.length, 2);
  assert.deepEqual(intervals.map(item => [item.entryAt, item.exitAt]), [['2026-11-05T10:00:10.000Z', '2026-11-05T10:00:40.000Z'], ['2026-11-05T10:01:00.000Z', '2026-11-05T10:01:30.000Z']]);
});

test('invalid timestamps and boundary contacts are uncertain, not confirmed', () => {
  const badTimes = [{ ...points[0], timestamp: 'invalid' }, points[1]];
  const data = prepareDossierAirspaces(badTimes, collection(feature('bad-times')));
  assert.equal(data.uncertain[0].spatialStatus, 'UNCERTAIN');
  assert.equal(data.uncertain[0].passages[0].entryAt, null);
  assert.equal(data.invalidSegments, 1);
  const boundary = prepareDossierAirspaces([at(0,150,0),at(10,150,100)], collection(feature('boundary')));
  assert.equal(boundary.uncertain[0].spatialStatus, 'UNCERTAIN');
});

test('radio preserves unmodified OpenAIP values and explicitly marks old-cache provenance uncertainty', () => {
  const features = openAipAirspacesToGeoJson({ items: [{ _id: 'lille', name: 'CTR LILLE', type: 4, icaoClass: 3, geometry: { type: 'Polygon', coordinates: [box(1,2)] }, lowerLimit: limit(100), upperLimit: limit(900), frequencies: [{ value: '118.550', name: 'LILLE TWR', unit: 2 }], activity: 1, byNotam: true, activeFrom: '2026-01-01', activeUntil: '2027-01-01' }] });
  assert.equal(features.features[0].properties.frequencies[0].value, '118.555'); // Existing map correction unchanged.
  const item = prepareDossierAirspaces(points, features).uncertain[0];
  assert.equal(item.frequencies.values[0].value, '118.550');
  assert.equal(item.frequencies.rawSourceAvailable, true);
  assert.equal(item.frequencies.verifiedAgainstAip, false);
  assert.equal(item.activity.published.byNotam, true);
  assert.equal(item.activity.status, 'UNKNOWN');
  assert.equal(item.status, 'UNCERTAIN');
  const old = feature('old');
  const legacy = prepareDossierAirspaces(points, collection(old)).uncertain[0];
  assert.equal(legacy.frequencies.rawSourceAvailable, false);
  assert.match(legacy.frequencies.notice, /corrections locales/);
});


test('spatially variable published limits do not establish a constant-floor exclusion or confirmation', () => {
  const zone = feature('variable', limit(600), limit(900));
  zone.properties.lowerLimitMin = limit(100);
  const data = prepareDossierAirspaces(points, collection(zone));
  assert.equal(data.uncertain.length, 1);
  assert.equal(data.uncertain[0].spatialStatus, 'UNCERTAIN');
  assert.ok(data.uncertain[0].reasons.includes('VARIABLE_FLOOR_UNRESOLVED'));
});
