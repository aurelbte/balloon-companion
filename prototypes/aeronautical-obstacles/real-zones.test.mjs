import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSia, normalizeOsm, deduplicateObservations, relateRecords, geometryDistanceM } from './normalize.ts';

// These fixtures are unchanged real source rows, with study provenance; not invented test obstacles.
const fixture = async zone => JSON.parse(await readFile(new URL(`./fixtures/${zone}.json`, import.meta.url), 'utf8'));
const havre = await fixture('le-havre'), grenoble = await fixture('grenoble');
const normalize = rows => rows.map(raw => normalizeOsm(raw, [])).filter(Boolean);

test('Le Havre: all 13 real cranes have unknown heights and permanence; mobility does not imply temporary', () => {
  const cranes = normalize(havre.osm).filter(r => r.category === 'crane');
  assert.equal(cranes.length, 13);
  assert.ok(cranes.every(r => r.measurements.declaredHeight.valueM === null && r.measurements.heightAgl.valueM === null));
  assert.ok(cranes.every(r => r.measurements.topAmsl.valueM === null && r.permanence === 'unknown'));
  assert.equal(cranes.filter(r => r.mobility === 'mobile').length, 7);
  assert.ok(cranes.every(r => r.physicalStatus === 'unknown'));
});

test('Le Havre: SIA 76028 represents two chimneys, never a third individual chimney', () => {
  const sia = havre.sia.map(raw => normalizeSia(raw, []));
  assert.equal(sia.filter(r => r.recordScope === 'group').length, 2);
  const group = sia.find(r => r.sourceId === '76028');
  assert.equal(group.declaredCount, 2); assert.equal(group.geometryRole, 'group_point');
  assert.equal(group.recordScope, 'group'); assert.equal(group.measurements.heightAgl.valueM, 787 * 0.3048);
  const chimneys = normalize(havre.osm.filter(r => ['way/69875855', 'way/69875893'].includes(r.id)));
  assert.equal(chimneys.length, 2); assert.ok(chimneys.every(r => r.category === 'chimney_flare'));
  const records = deduplicateObservations([group, ...chimneys]).records;
  assert.equal(records.length, 3); // Source representations, not a physical obstacle total.
  const links = relateRecords(records).filter(l => [l.fromObservationId, l.toObservationId].includes(group.observationId));
  assert.equal(links.length, 2);
  assert.ok(links.every(l => l.relation === 'possible_representation' && l.decision === 'ambiguous'));
  assert.ok(links.every(l => l.alternatives.length === 1));
});

test('Le Havre: flare/chimney types, building components and composite SIA heights stay distinct', () => {
  const rows = normalize(havre.osm);
  assert.ok(rows.some(r => r.sourceType === 'flare' && r.category === 'chimney_flare'));
  assert.ok(rows.some(r => r.sourceType === 'chimney' && r.category === 'chimney_flare'));
  const component = rows.find(r => r.sourceId === 'way/445097158');
  assert.equal(component.recordScope, 'component'); assert.equal(component.siteId, null);
  for (const id of ['76049', '76052']) {
    const r = normalizeSia(havre.sia.find(r => r.IDENTIFICATEUR === id), []);
    assert.equal(r.recordScope, 'composite'); assert.equal(r.siteId, null);
    assert.ok(r.original.REMARQUE.includes('+'));
  }
  const group = normalizeSia(havre.sia.find(r => r.IDENTIFICATEUR === '76034'), []);
  const links = relateRecords([group, ...rows.filter(r => ['way/1085528283', 'way/1085528284'].includes(r.sourceId))]);
  assert.ok(links.some(l => l.relation === 'possible_representation'));
  assert.ok(links.every(l => l.decision === 'ambiguous'));
  const disused = rows.find(r => r.sourceId === 'way/69875689');
  assert.equal(disused.operationStatus, 'disused'); assert.equal(disused.physicalStatus, 'unknown');
  assert.equal(disused.dates.validUntil, null); // End of operation is not removal.
});

test('Grenoble: real SIA cables remain points with distinct published AGL/AMSL/IGN69 values', () => {
  const cables = grenoble.sia.map(raw => normalizeSia(raw, [])).filter(r => r.category === 'aerial_cable');
  assert.equal(cables.length, 2);
  for (const r of cables) {
    assert.equal(r.geometry.type, 'Point'); assert.equal(r.geometryRole, 'representative_point');
    assert.equal(r.verticalProfile, 'unknown'); assert.equal(r.measurements.topAmsl.datum, 'IGN69');
    assert.equal(r.measurements.heightAgl.reference, 'AGL'); assert.equal(r.measurements.topAmsl.reference, 'AMSL');
  }
  const high = cables.find(r => r.sourceId === '38022');
  assert.equal(high.measurements.heightAgl.valueM, 236 * 0.3048);
  assert.equal(high.measurements.topAmsl.valueM, 7316 * 0.3048);
  assert.ok(high.original.REMARQUE.includes('1944'));
});

test('Grenoble: native cable routes are preserved vertex-for-vertex; pylons and point associations are not duplicates', () => {
  const rows = normalize(grenoble.osm);
  const routes = rows.filter(r => r.category === 'aerial_cable');
  assert.equal(routes.length, 5);
  for (const r of routes) {
    assert.equal(r.geometry.type, 'LineString'); assert.equal(r.geometryRole, 'source_trace');
    assert.deepEqual(r.geometry, grenoble.osm.find(raw => raw.id === r.sourceId).geometry);
    assert.equal(r.verticalProfile, 'unknown'); assert.equal(r.measurements.topAmsl.valueM, null);
  }
  const supports = rows.filter(r => r.category === 'cable_support');
  assert.equal(supports.length, 2); assert.ok(supports.every(r => r.geometry.type === 'Point'));
  const sia = grenoble.sia.filter(raw => raw.TYPE === 'Câble').map(raw => normalizeSia(raw, []));
  const records = deduplicateObservations([...sia, ...routes, ...supports]).records;
  assert.equal(records.length, 9);
  const links = relateRecords(records);
  const contexts = links.filter(l => l.distanceMethod === 'point_trace_local_projection');
  assert.equal(contexts.length, 2);
  assert.ok(contexts.every(l => l.relation === 'possible_representation' && l.decision === 'ambiguous' && l.heightComparison === null));
  assert.ok(links.every(l => l.relation !== 'possible_same_object'));
  const disused = routes.find(r => r.sourceId === 'way/82898404');
  assert.equal(disused.operationStatus, 'disused'); assert.equal(disused.physicalStatus, 'unknown');
  // The old study counted only disused:* prefixes, overlooking two explicit disused=yes routes.
  for (const id of ['way/128191255', 'way/181562097']) {
    const explicit = routes.find(r => r.sourceId === id);
    assert.equal(explicit.original.tags.disused, 'yes');
    assert.equal(explicit.operationStatus, 'disused'); assert.equal(explicit.physicalStatus, 'unknown');
  }
});

test('Grenoble: hydraulic dimension and rooftop/building part do not create AGL or summit altitudes', () => {
  const rows = normalize(grenoble.osm);
  const hydraulic = rows.find(r => r.sourceId === 'node/9291321377');
  assert.equal(hydraulic.measurements.declaredHeight.valueM, 180);
  assert.equal(hydraulic.measurements.heightAgl.valueM, null); assert.equal(hydraulic.measurements.topAmsl.valueM, null);
  const part = rows.find(r => r.sourceId === 'way/233263819');
  assert.equal(part.recordScope, 'component'); assert.equal(part.measurements.declaredHeight.valueM, 98);
  assert.equal(part.measurements.heightAgl.valueM, null);
  const composite = normalizeSia(grenoble.sia.find(r => r.IDENTIFICATEUR === '38015'), []);
  assert.equal(composite.recordScope, 'composite'); assert.equal(composite.measurements.heightAgl.valueM, 374 * 0.3048);
});

test('linear circle selection measures the trace rather than its centroid/endpoints; no vertical distance', () => {
  const crossing = { type: 'LineString', coordinates: [[5.3, 45.19], [6.1, 45.19]] };
  assert.ok(geometryDistanceM([5.7, 45.19], crossing) < 1e-8);
  const far = { type: 'MultiLineString', coordinates: [[[5.3, 46], [6.1, 46]]] };
  assert.ok(geometryDistanceM([5.7, 45.19], far) > 80_000);
});
