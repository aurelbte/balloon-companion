import test from 'node:test';
import assert from 'node:assert/strict';
import { obstacleMeasurement, obstacleSourceId } from './aeronauticalObstacles.ts';

test('measurement converts feet/metres without rounding away original values or datum', () => {
  const m = obstacleMeasurement('666', 'FT', 'AGL', null, 'HAUTEUR HORS SOL');
  assert.equal(m.valueM, 666 * 0.3048);
  assert.equal(m.originalValue, '666'); assert.equal(m.originalUnit, 'FT');
  assert.equal(obstacleMeasurement('125,50', 'm', 'AGL', null, 'height').valueM, 125.5);
  assert.equal(obstacleMeasurement('1034', 'FT', 'AMSL', 'IGN69', 'top').datum, 'IGN69');
});

test('missing values and unknown datum/unit never become zero or an invented reference', () => {
  for (const value of [null, undefined, '', ' ']) {
    const m = obstacleMeasurement(value, 'm', 'AGL', null, 'height');
    assert.equal(m.valueM, null); assert.equal(m.unknownReason, 'missing');
  }
  const top = obstacleMeasurement('200', 'm', 'AMSL', '', 'top');
  assert.equal(top.valueM, 200); assert.equal(top.datum, null);
  assert.equal(obstacleMeasurement('200', null, 'AMSL', null, 'top').valueM, null);
  assert.equal(obstacleMeasurement('12;30', 'm', 'UNKNOWN', null, 'height').valueM, null);
  // Zero is legitimate when explicitly provided (e.g. an altitude), not a missing-value sentinel.
  assert.equal(obstacleMeasurement(0, 'm', 'AMSL', null, 'top').valueM, 0);
});

test('source identities are stable, qualified and collision resistant', () => {
  assert.equal(obstacleSourceId('SIA', '76009'), 'SIA:76009');
  assert.notEqual(obstacleSourceId('OSM', 'node/1'), obstacleSourceId('OSM', 'way/1'));
  assert.notEqual(obstacleSourceId('OSM', 'node/1'), obstacleSourceId('OSM', 'node%2F1'));
  assert.notEqual(obstacleSourceId('SIA', '1'), obstacleSourceId('GEORISQUES', '1'));
  assert.throws(() => obstacleSourceId('SIA', ' '));
});
