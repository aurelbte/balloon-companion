import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_SATELLITE_LAYER, launchSatelliteSource, setLaunchPointBaseMap } from './launchPointBaseMap.ts';

test('reuses MapTiler Hybrid and requires the existing public key', () => {
  assert.equal(launchSatelliteSource(''), null);
  assert.equal(launchSatelliteSource('   '), null);
  const source = launchSatelliteSource(' test/key ');
  assert.equal(source.tiles[0], 'https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}@2x.jpg?key=test%2Fkey');
  assert.match(source.attribution, /MapTiler/);
  assert.match(source.attribution, /OpenStreetMap/);
});

test('switches only layer visibility, keeping the same map, marker and coordinates', () => {
  const visibility = new Map();
  const map = { getLayer: () => ({}), setLayoutProperty: (id, property, value) => { assert.equal(property, 'visibility'); visibility.set(id, value); } };
  assert.equal(setLaunchPointBaseMap(map, 'satellite'), 'satellite');
  assert.equal(visibility.get('plan-base'), 'none');
  assert.equal(visibility.get(LAUNCH_SATELLITE_LAYER), 'visible');
  assert.equal(setLaunchPointBaseMap(map, 'plan'), 'plan');
  assert.equal(visibility.get('plan-base'), 'visible');
  assert.equal(visibility.get(LAUNCH_SATELLITE_LAYER), 'none');
});

test('unavailable satellite falls back to Plan without touching an absent layer', () => {
  const changes = [];
  const map = { getLayer: id => id === 'plan-base' ? {} : undefined, setLayoutProperty: (...args) => changes.push(args) };
  assert.equal(setLaunchPointBaseMap(map, 'satellite'), 'plan');
  assert.deepEqual(changes, [['plan-base', 'visibility', 'visible']]);
});
