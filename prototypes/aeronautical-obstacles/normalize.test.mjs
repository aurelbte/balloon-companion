import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSia, normalizeGeorisques, normalizeOsm, deduplicateObservations, relateRecords, canonical } from './normalize.ts';

// Synthetic fixtures for behaviour only; never included in the local generated inventory.
const sia = (overrides = {}) => ({ IDENTIFICATEUR: 'test-1', TYPE: 'Eolienne', NOMBRE: '1',
  'LONGITUDE DECIMALE': '1.5', 'LATITUDE DECIMALE': '49.88', 'SYSTEME DE REFERENCE HORIZONTALE': 'WGS84',
  'HAUTEUR HORS SOL': '551', 'ALTITUDE AU SOMMET': '1000', UNITE: 'FT',
  'PRECISION HORIZONTALE': '50 m', 'PRECISION VERTICALE': '100 ft', 'SYSTEME REFERENCE VERTICALE': 'IGN69', ...overrides });
const geo = (overrides = {}) => ({ id_aerogenerateur: 'test-E1', longitude: 1.5001, latitude: 49.88,
  hauteur_totale: '125', hauteur_mat_nacelle: '80', cote_ngf: '185', etat_parc: 'En exploitation',
  statut_parc: 'Autorisé', date_maj: '2026-04-13 10:14:23', ...overrides });
const osm = (overrides = {}) => ({ id: 'node/1', longitude: 1.5002, latitude: 49.88,
  position_method: 'node', osm_version: 1, tags: { power: 'generator', 'generator:source': 'wind', height: '125 m', source: 'Géorisques' }, ...overrides });

test('SIA ambiguous pylons and group points retained without inferring electrical use or presence', () => {
  const raw = sia({ TYPE: 'Pylône', NOMBRE: '2' });
  const r = normalizeSia(raw, ['sia-test']);
  assert.equal(r.category, 'particular_obstacle'); assert.equal(r.geometryRole, 'group_point');
  assert.equal(r.declaredCount, 2); assert.equal(r.physicalStatus, 'unknown');
  assert.ok(r.issues.some(i => i.code === 'AMBIGUOUS_PYLON_USE')); assert.deepEqual(r.original, raw);
  assert.equal(r.measurements.topAmsl.datum, 'IGN69'); assert.equal(r.measurements.heightAgl.accuracyM, 30.48);
  assert.equal(normalizeSia(sia({ 'SYSTEME REFERENCE VERTICALE': '' }), []).measurements.topAmsl.datum, null);
});

test('Georisques distinguishes physical lifecycle from administrative authorization', () => {
  for (const [state, admin, physical, administrative] of [
    ['En exploitation', 'Autorisé', 'existing', 'authorized'],
    ['En construction', 'Autorisé', 'under_construction', 'authorized'],
    ['En attente de construction', 'Autorisé', 'planned', 'authorized'],
    ['', 'En instruction', 'unknown', 'under_review'],
    ['', 'Autorisé', 'unknown', 'authorized'],
  ]) {
    const r = normalizeGeorisques(geo({ etat_parc: state, statut_parc: admin }), []);
    assert.equal(r.physicalStatus, physical); assert.equal(r.administrativeStatus, administrative);
    assert.equal(r.measurements.topAmsl.valueM, null);
    assert.equal(r.measurements.additional[1].valueM, 185); assert.equal(r.measurements.additional[1].reference, 'UNKNOWN');
    assert.equal(r.dates.editedAtUtc, null); assert.equal(r.dates.editedAtRaw, '2026-04-13 10:14:23');
  }
});

test('OSM ordinary electrical supports excluded, unknown and original dimensions preserved', () => {
  for (const tags of [{ power: 'tower' }, { power: 'pole' }, { 'disused:power': 'tower', man_made: 'tower' }]) {
    assert.equal(normalizeOsm(osm({ tags }), []), null);
  }
  const r = normalizeOsm(osm(), ['osm-test']);
  assert.equal(r.physicalStatus, 'unknown'); assert.equal(r.measurements.heightAgl.valueM, null);
  assert.equal(r.measurements.declaredHeight.valueM, 125); assert.equal(r.measurements.declaredHeight.originalValue, '125 m');
  assert.equal(r.measurements.declaredHeight.reference, 'UNKNOWN'); assert.equal(r.measurements.topAmsl.valueM, null);
  assert.deepEqual(r.lineage, { citedSources: ['Géorisques'], independence: 'not_established' });
  const blank = normalizeOsm(osm({ tags: { man_made: 'mast', height: '' }, position_method: 'area centroid (proxy)' }), []);
  assert.equal(blank.measurements.declaredHeight.valueM, null); assert.equal(blank.geometryRole, 'representative_point');
});

test('OSM construction, projects, disuse, removal, permanence and mobility remain separate', () => {
  for (const [tags, status] of [
    [{ 'construction:generator:source': 'wind' }, 'under_construction'],
    [{ 'proposed:generator:source': 'wind' }, 'planned'],
    [{ 'disused:man_made': 'mast' }, 'unknown'],
    [{ 'demolished:man_made': 'mast' }, 'removed'],
  ]) assert.equal(normalizeOsm(osm({ tags }), []).physicalStatus, status);
  const crane = normalizeOsm(osm({ tags: { man_made: 'crane', 'crane:mobile': 'rail' } }), []);
  assert.equal(crane.mobility, 'mobile'); assert.equal(crane.permanence, 'unknown');
  assert.equal(normalizeOsm(osm({ tags: { 'disused:man_made': 'mast' } }), []).operationStatus, 'disused');
});

test('cables retain native linear geometry or representative points; no vertical profile invented', () => {
  const geometry = { type: 'LineString', coordinates: [[1.5, 49.88], [1.51, 49.89]] };
  const raw = osm({ id: 'way/2', tags: { aerialway: 'zip_line', ele: '2200' }, geometry });
  const cable = normalizeOsm(raw, []);
  assert.deepEqual(cable.geometry, geometry); assert.equal(cable.geometryRole, 'source_trace');
  assert.equal(cable.category, 'aerial_cable'); assert.equal(cable.verticalProfile, 'unknown');
  assert.equal(cable.measurements.topAmsl.valueM, null);
  const siaCable = normalizeSia(sia({ TYPE: 'Câble' }), []);
  assert.equal(siaCable.geometry.type, 'Point'); assert.equal(siaCable.geometryRole, 'representative_point');
  assert.equal(siaCable.verticalProfile, 'unknown');
  const association = relateRecords([siaCable, cable]);
  assert.equal(association.length, 1);
  assert.equal(association[0].relation, 'possible_representation');
  assert.equal(association[0].decision, 'ambiguous');
  assert.equal(association[0].heightComparison, null); // Context only; not an identity or vertical match.
  assert.throws(() => normalizeOsm({ ...raw, geometry: { type: 'LineString', coordinates: [[1, 2]] } }, []));
});

test('height disagreements retained on candidates; unknown OSM reference is not a proven AGL conflict', () => {
  const records = [normalizeSia(sia(), []), normalizeGeorisques(geo(), []), normalizeOsm(osm(), [])];
  const before = canonical(records), links = relateRecords(records);
  const agl = links.find(l => l.heightComparison?.comparableAgl);
  assert.ok(Math.abs(agl.heightComparison.differenceM - (551 * 0.3048 - 125)) < 1e-10);
  assert.equal(agl.heightComparison.reviewRequired, true);
  assert.ok(links.some(l => l.heightComparison && !l.heightComparison.comparableAgl));
  assert.ok(links.every(l => l.decision !== 'confirmed')); assert.equal(canonical(records), before);
});

test('distance-only matches, alternatives and incompatible nearby categories never merge', () => {
  const a = normalizeSia(sia({ TYPE: 'Pylône' }), []);
  const b = normalizeOsm(osm({ tags: { man_made: 'mast' } }), []);
  const c = normalizeOsm(osm({ id: 'node/2', longitude: 1.5003, tags: { man_made: 'mast' } }), []);
  const links = relateRecords([a, b, c]);
  assert.equal(links.filter(l => l.relation === 'possible_same_object').length, 2);
  assert.ok(links.filter(l => l.relation === 'possible_same_object').every(l => l.decision === 'ambiguous' && l.alternatives.length === 1));
  const incompatible = relateRecords([normalizeSia(sia(), []), b]);
  assert.equal(incompatible[0].relation, 'possible_colocation'); assert.equal(incompatible[0].decision, 'ambiguous');
  assert.equal(relateRecords([normalizeSia(sia(), []), normalizeGeorisques(geo(), [])])[0].decision, 'candidate');
});

test('duplicate observations collapse only exact content; IDs stable across order and variants retained', () => {
  const raw = osm(), a = normalizeOsm(raw, ['one']), b = normalizeOsm({ ...raw }, ['two']);
  const changed = normalizeOsm(osm({ tags: { ...raw.tags, height: '130' } }), ['two']);
  const result = deduplicateObservations([changed, a, b]);
  assert.equal(result.duplicateObservations, 1); assert.equal(result.records.length, 2);
  assert.equal(a.id, changed.id); assert.notEqual(a.observationId, changed.observationId);
  assert.deepEqual(result.records.find(r => r.observationId === a.observationId).sourceEditionIds, ['one', 'two']);
  assert.equal(relateRecords(result.records)[0].relation, 'same_source_variant');
  assert.deepEqual(relateRecords([a, changed]), relateRecords([changed, a]));
  assert.equal(normalizeOsm(Object.fromEntries(Object.entries(raw).reverse()), []).observationId, a.observationId);
  assert.throws(() => normalizeSia(sia({ IDENTIFICATEUR: '' }), []));
});
