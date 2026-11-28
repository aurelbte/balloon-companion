#!/usr/bin/env node
/** Offline CLI. Reads the retained study, never queries APIs or publishes anything. */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256, normalizeSia, normalizeGeorisques, normalizeOsm,
  deduplicateObservations, relateRecords, geometryDistanceM, osmExclusionReason, CENTRE, RADIUS_M, METHOD } from './normalize.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = resolve(HERE, '../..');
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
function requireThat(value, message) { if (!value) throw new Error(message); }
function requireOutsideRepository(path) {
  const rel = relative(REPOSITORY, path);
  requireThat(rel.startsWith(`..${sep}`) || isAbsolute(rel), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
}
async function checkedOutput(path) {
  requireOutsideRepository(path);
  let ancestor = path;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      requireOutsideRepository(resolve(actual, relative(ancestor, path)));
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
}

export const ZONES = ['preuseville', 'le-havre', 'grenoble'];

/** Backward-compatible study inputs. Never label a fresh source as the old AIRAC. */
export function studySourceSpec(inventory) {
  const source = inventory.sourceFiles?.sia ?? { artifact: 'sia-20261029.xlsx', referenceDate: '2026-10-29', airacCycle: '2026-10-29', license: null };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  requireThat(/^sia-\d{8}\.xlsx$/.test(source.artifact ?? '') && validDate(source.referenceDate) && validDate(source.airacCycle)
    && source.artifact === `sia-${source.referenceDate.replaceAll('-', '')}.xlsx`
    && (source.license === null || typeof source.license === 'string'), 'INVALID_STUDY_SIA_EDITION');
  const scripts = inventory.extractionScripts;
  requireThat(scripts === undefined || Array.isArray(scripts) && scripts.length > 0 && new Set(scripts).size === scripts.length
    && scripts.every(file => typeof file === 'string' && /^[a-zA-Z0-9_/-]+\.py$/.test(file) && !file.startsWith('/') && !file.split('/').includes('..')), 'INVALID_EXTRACTION_SCRIPT_PATH');
  return { sia: source, scripts };
}

export async function buildZone(zone, studyPath = '/tmp/bc-obstacles-study', outputPath) {
  requireThat(ZONES.includes(zone), `UNSUPPORTED_ZONE: ${zone}`);
  const study = await realpath(studyPath);
  const local = zone === 'preuseville' ? study : join(study, zone);
  const inventory = await readJson(join(local, 'sources.json'));
  const sourceSpec = studySourceSpec(inventory), siaFile = sourceSpec.sia.artifact;
  const config = zone === 'preuseville' ? { longitude: CENTRE[0], latitude: CENTRE[1], radius_m: RADIUS_M } :
    await readJson(join(local, 'study-config.json'));
  requireThat([config.longitude, config.latitude, config.radius_m].every(Number.isFinite) && config.radius_m > 0, 'INVALID_STUDY_CONFIG');
  const centre = [config.longitude, config.latitude], radiusM = config.radius_m;
  const [sia, geo, osm, siaMeta, geoMeta] = await Promise.all([
    readJson(join(local, 'sia-local-raw.json')), readJson(join(local, 'georisques-local-raw.json')),
    readJson(join(local, 'osm-local-raw.json')), readJson(join(study, `${siaFile}.metadata.json`)),
    readJson(join(study, 'georisques-turbine.csv.metadata.json')),
  ]);
  requireThat(Array.isArray(sia) && Array.isArray(geo) && Array.isArray(osm.elements) && Array.isArray(osm.sources), 'INVALID_STUDY_COLLECTIONS');
  const inputs = [];
  // All retained originals are checked, including the regional PBFs, without a network request.
  const originals = [siaFile, 'georisques-turbine.csv', ...osm.sources.map(source => `${source.region}.osm.pbf`)];
  for (const file of [...originals, 'sia-local-raw.json', 'georisques-local-raw.json', 'osm-local-raw.json']) {
    const localExtract = file.endsWith('-local-raw.json');
    const expected = inventory.raw_files?.find(item => item.file === file) ??
      inventory.raw_inputs?.find(item => item.path.split('/').at(-1) === file);
    requireThat(localExtract || expected, `MISSING_SOURCE_PROVENANCE: ${file}`);
    let path = join(localExtract ? local : study, file);
    if (!localExtract && file.endsWith('.pbf')) {
      try { await realpath(path); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        path = join(study, 'shared', file);
      }
    }
    const hash = await hashFile(path);
    if (expected) requireThat(/^[a-f0-9]{64}$/.test(expected.sha256) && hash === expected.sha256, `SOURCE_SHA256_MISMATCH: ${file}`);
    // Later studies did not pre-attest local JSON hashes. Capture them now, without pretending otherwise.
    inputs.push({ file, sha256: hash, integrity: expected ? 'verified_against_study_inventory' : 'captured_local_extract_not_pre_attested' });
  }
  for (const [file, metadata] of [[siaFile, siaMeta], ['georisques-turbine.csv', geoMeta]]) {
    requireThat(metadata.status === 200 && metadata.sha256 === inputs.find(i => i.file === file).sha256, `INVALID_DOWNLOAD_METADATA: ${file}`);
  }
  requireThat((siaMeta.referenceDate === undefined || siaMeta.referenceDate === sourceSpec.sia.referenceDate)
    && (siaMeta.airacCycle === undefined || siaMeta.airacCycle === sourceSpec.sia.airacCycle), 'SIA_EDITION_METADATA_MISMATCH');
  const sources = [
    { id: `sia-enr54-${sourceSpec.sia.referenceDate.replaceAll('-', '')}`, source: 'SIA', url: siaMeta.final_url ?? siaMeta.url,
      artifact: siaFile, sha256: siaMeta.sha256, referenceDate: sourceSpec.sia.referenceDate, airacCycle: sourceSpec.sia.airacCycle,
      snapshotAtUtc: null, retrievedAtUtc: siaMeta.completed_at_utc ?? siaMeta.requested_at_utc ?? null, license: sourceSpec.sia.license,
      attribution: sourceSpec.sia.license ? 'Service de l’Information Aéronautique / DGAC — ENR 5.4; attribution et date à conserver' : 'SIA / DGAC — ENR 5.4; redistribution conditions to verify' },
    { id: 'georisques-eolien-study', source: 'GEORISQUES', url: geoMeta.final_url ?? geoMeta.url,
      artifact: 'georisques-turbine.csv', sha256: geoMeta.sha256, referenceDate: null, airacCycle: null,
      snapshotAtUtc: null, retrievedAtUtc: geoMeta.completed_at_utc ?? geoMeta.requested_at_utc ?? null, license: 'Licence Ouverte 2.0 — verify dataset-specific third-party conditions',
      attribution: 'Géorisques / Ministère de la Transition écologique — individual date_maj retained without assumed timezone' },
    ...osm.sources.map(source => {
      requireThat(source.sha256 === inputs.find(i => i.file === `${source.region}.osm.pbf`)?.sha256, `INVALID_OSM_SOURCE: ${source.region}`);
      return { id: `osm-${source.region}-${source.sha256}`, source: 'OSM', url: source.url ?? null,
        artifact: `${source.region}.osm.pbf`, sha256: source.sha256, referenceDate: null, airacCycle: null,
        snapshotAtUtc: source.snapshot_utc ?? null, retrievedAtUtc: source.retrieved_at_utc ?? null, license: 'ODbL-1.0',
        attribution: '© OpenStreetMap contributors · Geofabrik' };
    }),
  ];
  const records = [], excluded = [], outside = [];
  const include = record => {
    // Preserve complete native traces, even where some vertices extend beyond the circle.
    if (geometryDistanceM(centre, record.geometry) <= radiusM) records.push(record);
    else outside.push({ observationId: record.observationId, reason: 'outside_study_circle', original: record.original });
  };
  for (const raw of sia) include(normalizeSia(raw, [sources[0].id]));
  for (const raw of geo) include(normalizeGeorisques(raw, [sources[1].id]));
  for (const raw of osm.elements) {
    if (raw.unresolved_native_geometry === true) {
      excluded.push({ source: 'OSM', sourceId: raw.id, reason: osmExclusionReason(raw) ?? 'native_relation_geometry_unresolved_requires_review', original: raw });
      continue;
    }
    const editions = (raw.extracts ?? []).map(region => {
      const source = sources.find(s => s.source === 'OSM' && s.artifact === `${region}.osm.pbf`);
      requireThat(source, `MISSING_OSM_EDITION: ${region}`); return source.id;
    });
    requireThat(editions.length, `MISSING_OSM_LINEAGE: ${raw.id}`);
    const record = normalizeOsm(raw, editions);
    if (record) include(record);
    else excluded.push({ source: 'OSM', sourceId: raw.id, reason: osmExclusionReason(raw), original: raw });
  }
  const unique = deduplicateObservations(records);
  const links = relateRecords(unique.records);
  const counts = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(v => v === value).length]));
  const summary = { sourceRecords: Object.fromEntries(['SIA', 'GEORISQUES', 'OSM'].map(source => [source, unique.records.filter(r => r.source === source).length])), records: unique.records.length,
    sourceIdentities: new Set(unique.records.map(r => r.id)).size, duplicateObservations: unique.duplicateObservations,
    excluded: counts(excluded.map(r => r.reason)), outsideCircle: outside.length,
    georisquesPhysicalStatuses: counts(unique.records.filter(r => r.source === 'GEORISQUES').map(r => r.physicalStatus)),
    links: links.length, linkDecisions: counts(links.map(l => l.decision)),
    aglHeightReviews: links.filter(l => l.heightComparison?.comparableAgl && l.heightComparison.reviewRequired).length,
    declaredDimensionReviews: links.filter(l => l.heightComparison && !l.heightComparison.comparableAgl && l.heightComparison.reviewRequired).length,
    cables: unique.records.filter(r => r.category === 'aerial_cable').length,
    byCategory: counts(unique.records.map(r => r.category)), byPhysicalStatus: counts(unique.records.map(r => r.physicalStatus)),
    byAdministrativeStatus: counts(unique.records.map(r => r.administrativeStatus)), byScope: counts(unique.records.map(r => r.recordScope)),
    bySource: Object.fromEntries(['SIA', 'GEORISQUES', 'OSM'].map(source => {
      const rows = unique.records.filter(r => r.source === source);
      return [source, { categories: counts(rows.map(r => r.category)), sourceTypes: counts(rows.map(r => r.sourceType ?? 'unknown')),
        physicalStatuses: counts(rows.map(r => r.physicalStatus)), permanence: counts(rows.map(r => r.permanence)),
        missingDeclaredHeights: rows.filter(r => r.measurements.declaredHeight.valueM === null).length }];
    })),
    nativeTraces: unique.records.filter(r => r.geometry.type !== 'Point').length,
    cablePointTraceAssociations: links.filter(l => l.distanceMethod === 'point_trace_local_projection').length,
    physicalObjectCount: null };
  const code = [];
  for (const file of ['normalize.ts', 'build.mjs', 'preuseville.mjs', '../../app/lib/aeronauticalObstacles.ts']) {
    code.push({ file, sha256: await hashFile(resolve(HERE, file)) });
  }
  const metadata = [
    { file: 'sources.json', sha256: await hashFile(join(local, 'sources.json')) },
    ...await Promise.all([`${siaFile}.metadata.json`, 'georisques-turbine.csv.metadata.json'].map(async file => ({ file, sha256: await hashFile(join(study, file)) }))),
    ...await Promise.all((sourceSpec.scripts ?? (zone === 'preuseville' ? ['fetch.py', 'extract_osm.py', 'normalize.py'] :
      ['shared/common.py', 'shared/prepare_sources.py', 'shared/extract_zones.py', ...(zone === 'grenoble' ? ['shared/extract_linear.py'] : [])]))
      .map(async file => ({ file, sha256: await hashFile(join(study, file)) }))),
  ];
  if (zone !== 'preuseville') metadata.push({ file: 'study-config.json', sha256: await hashFile(join(local, 'study-config.json')) });
  const identity = { zone, method: METHOD, centre, radiusM, config, inputs, metadata, code };
  const version = sha256(canonical(identity));
  const output = resolve(outputPath ?? `/tmp/bc-aeronautical-obstacles/${zone}/${version.slice(0, 16)}`);
  // Check existing ancestors before creating directories, including symlinks into the repository.
  await checkedOutput(output);
  await mkdir(resolve(output, '..'), { recursive: true });
  const parent = await realpath(resolve(output, '..'));
  requireOutsideRepository(parent);
  await mkdir(output); // Refuse overwriting any existing output or previous study.
  const limitations = [
    'Local non-exhaustive source inventory, not a certified navigation or clearance database',
    inventory.acquisition?.freshExtraction === true
      ? 'Fresh XLSX/PBF/WFS extraction precedes this normalization; raw sources, horizontal CRS conversion and extraction scripts retained'
      : 'Reuses verified study extracts; XLSX/PBF extraction and CRS transformation not rerun here',
    inventory.acquisition?.freshExtraction === true
      ? 'Only exactly identical overlapping PBF observations collapsed; other variants and original regional PBFs retained'
      : 'OSM extraction already resolved overlapping PBF observations; original discarded variants cannot be reconstructed from it',
    inventory.acquisition?.freshExtraction === true
      ? 'OSM surface structures use explicit representative points; available original outlines retained in source records, not converted to cable routes'
      : 'OSM polygons/ways may be represented by study centroids; native geometries not recreated',
    ...(summary.cables ? ['Cable geometry is 2D only; no complete vertical profile or ground clearance is established'] : ['No cable in this local inventory']),
    inventory.acquisition?.nativeTracesByIntersection === true
      ? 'Native OSM traces selected by 2D intersection, not centroid; surface objects still use explicit representative points'
      : 'Original study OSM selection used centroids; routes intersecting the circle with an outside centroid may be absent',
    ...(inventory.acquisition?.georisquesScope ? [`Géorisques extraction scope: ${inventory.acquisition.georisquesScope}`] : []),
    ...(Number.isFinite(inventory.acquisition?.osmCoverage?.nominalAreaCoverageFraction) && inventory.acquisition.osmCoverage.nominalAreaCoverageFraction < .999999
      ? [`OSM regional extract footprint covers ${(inventory.acquisition.osmCoverage.nominalAreaCoverageFraction * 100).toFixed(2)}% of the study circle; remaining area is not acquired, never implicitly obstacle-free`] : []),
    ...(excluded.some(r => r.reason === 'native_relation_geometry_unresolved_requires_review')
      ? ['Tagged OSM relations without resolved native geometry retained in exclusions for review; no point or route invented'] : []),
    'Later study local JSON hashes are captured now where no prior hash was recorded; retained original source hashes are checked',
    'No automatic merge or physical-object count; every cross-source match requires review',
    'SIA publication/OSM mapping alone do not attest physical presence; park lifecycle is not turbine field verification',
    'No terrain-derived altitude, NOTAM ingestion, field verification, current-data refresh or legal clearance for publication',
    'Date-only or unzoned source dates are not assigned an invented UTC time',
  ];
  const artifacts = { 'records.json': unique.records, 'links.json': links, 'excluded.json': excluded, 'outside.json': outside,
    'divergences.json': links.filter(l => l.heightComparison?.reviewRequired || l.evidence.includes('different_physical_statuses')),
    'statistics.json': summary,
    'obstacles.geojson': { type: 'FeatureCollection', features: unique.records.map(r => ({ type: 'Feature', id: r.observationId,
      geometry: r.geometry, properties: { recordId: r.id, observationId: r.observationId, category: r.category,
        source: r.source, physicalStatus: r.physicalStatus, geometryRole: r.geometryRole, recordScope: r.recordScope } })) } };
  const hashes = {};
  for (const [file, value] of Object.entries(artifacts)) {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    hashes[file] = { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) };
    await writeFile(join(output, file), bytes, { flag: 'wx' });
  }
  const manifest = { schemaVersion: 2, dataset: `${zone}-aeronautical-obstacles-local`, version,
    generatedAtUtc: new Date().toISOString(), identity, sources, summary, limitations, artifacts: hashes };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { output, ...summary, limitations };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      requireThat(['--zone', '--study', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Usage: build.mjs [--zone preuseville|le-havre|grenoble] [--study root-directory] [--output new-directory-outside-git]');
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(await buildZone(options['--zone'] ?? 'preuseville', options['--study'] ?? '/tmp/bc-obstacles-study', options['--output']), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
