#!/usr/bin/env node
/** Local immutable packaging only: no network, upload, or application imports. */
import { readFile, writeFile, mkdir, realpath, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { canonical, sha256 } from './normalize.ts';
import { makeTiles, TILE_POLICY } from './tiles.ts';
import { boundsRing, tileBounds } from './tileGeometry.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');
const ZONES = ['preuseville', 'le-havre', 'grenoble'];
const REQUIRED = ['records.json', 'links.json', 'excluded.json', 'outside.json', 'divergences.json', 'statistics.json', 'obstacles.geojson'];
const encode = value => Buffer.from(canonical(value) + '\n');
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
const within = (parent, child) => { const r = relative(parent, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };

export const REDISTRIBUTION = {
  mode: 'LOCAL_PROTOTYPE_ONLY', publicRedistributionValidated: false, reviewDate: '2026-11-15',
  sources: [
    { source: 'OSM', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0',
      condition: 'Attribution and database obligations apply; combined/derived database obligations require review' },
    { source: 'GEORISQUES', url: 'https://www.georisques.gouv.fr/cgu', license: 'Licence Ouverte 2.0 for public downloads',
      condition: 'Mention producer and update date; verify dataset-specific third-party rights' },
    { source: 'SIA', url: 'https://www.sia.aviation-civile.gouv.fr/informationslegales', license: null,
      condition: 'Public information reuse subject to integrity, meaning, source and update date; transformed/composed product not cleared' },
  ],
  warning: 'Public access is not clearance for this transformed combined dataset. No public publication proposed.',
};

export async function loadNormalized(source) {
  const directory = await realpath(source), manifestBytes = await readFile(join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const zone = manifest.identity?.zone;
  requireThat(manifest.schemaVersion === 2 && ZONES.includes(zone) && manifest.dataset === `${zone}-aeronautical-obstacles-local`, 'UNSUPPORTED_NORMALIZED_MANIFEST');
  requireThat(/^[a-f0-9]{64}$/.test(manifest.version) && sha256(canonical(manifest.identity)) === manifest.version, 'NORMALIZED_VERSION_MISMATCH');
  requireThat(Array.isArray(manifest.sources) && manifest.sources.length, 'MISSING_SOURCE_PROVENANCE');
  const files = new Map(), parsed = new Map();
  for (const key of REQUIRED) {
    const entry = manifest.artifacts?.[key], path = join(directory, key);
    requireThat(entry && /^[a-f0-9]{64}$/.test(entry.sha256), `MISSING_ARTIFACT_HASH: ${key}`);
    requireThat((await lstat(path)).isFile() && await realpath(path) === path, `UNSAFE_INPUT_ARTIFACT: ${key}`);
    const bytes = await readFile(path);
    requireThat(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `NORMALIZED_SHA256_MISMATCH: ${key}`);
    files.set(key, bytes); parsed.set(key, JSON.parse(bytes));
  }
  const records = parsed.get('records.json'), links = parsed.get('links.json');
  requireThat(Array.isArray(records) && Array.isArray(links) && records.length === manifest.summary?.records, 'NORMALIZED_COUNT_MISMATCH');
  const editions = new Set(manifest.sources.map(s => s.id));
  requireThat(records.every(r => Array.isArray(r.sourceEditionIds) && r.sourceEditionIds.length && r.sourceEditionIds.every(id => editions.has(id))), 'UNKNOWN_SOURCE_EDITION');
  requireThat(['excluded.json', 'outside.json', 'divergences.json'].every(key => Array.isArray(parsed.get(key))), 'INVALID_NORMALIZED_LEDGER');
  return { directory, manifest, manifestBytes, files, records, links, parsed };
}
async function outsideRepoBeforeCreate(path) {
  requireThat(!within(REPO, path), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  let ancestor = path;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      const resolved = resolve(actual, relative(ancestor, path));
      requireThat(!within(REPO, resolved), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
      return resolved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
}
const count = values => Object.fromEntries([...new Set(values)].sort().map(v => [v, values.filter(x => x === v).length]));

export async function buildTiles(source, outputRoot = '/tmp/bc-aeronautical-obstacles/tiles') {
  const started = performance.now(), input = await loadNormalized(source), normalized = input.manifest;
  const { centre, radiusM, zone } = normalized.identity;
  requireThat(Array.isArray(centre) && centre.length === 2 && centre.every(Number.isFinite), 'INVALID_STUDY_CENTRE');
  const generated = makeTiles(input.records, input.links, centre, radiusM);
  const code = [];
  for (const file of ['tileGeometry.ts', 'tiles.ts', 'tile-build.mjs', 'normalize.ts', '../../app/lib/aeronauticalObstacles.ts']) {
    code.push({ file, sha256: sha256(await readFile(resolve(HERE, file))) });
  }
  const identity = { normalizedVersion: normalized.version, normalizedManifestSha256: sha256(input.manifestBytes),
    policy: TILE_POLICY, redistribution: REDISTRIBUTION, code, compression: { gzipLevel: 9, gzipHeaderOS: 255 },
    runtime: { node: process.versions.node, v8: process.versions.v8, zlib: process.versions.zlib } };
  const version = sha256(canonical(identity));
  const parent = resolve(outputRoot, zone), output = join(parent, version.slice(0, 16));
  const actualOutput = await outsideRepoBeforeCreate(output);
  requireThat(!within(input.directory, actualOutput) && !within(actualOutput, input.directory), 'OUTPUT_OVERLAPS_NORMALIZED_INPUT');
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  requireThat(!within(REPO, resolvedParent), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  try { await lstat(output); throw new Error('IMMUTABLE_OUTPUT_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(join(parent, '.building-'));
  try {
    const artifacts = {}, entries = [];
    const write = async (key, bytes, { contentType = 'application/json', gzip = false } = {}) => {
      const path = join(stage, key); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx' });
      const entry = { bytes: bytes.length, sha256: sha256(bytes), contentType };
      artifacts[key] = entry;
      if (gzip) {
        const compressed = gzipSync(bytes, { level: 9 });
        compressed[9] = 255; // Normalize OS metadata; timestamp is zero in Node's gzip output.
        await writeFile(`${path}.gz`, compressed, { flag: 'wx' });
        artifacts[`${key}.gz`] = { bytes: compressed.length, sha256: sha256(compressed), decodedSha256: entry.sha256, contentType, contentEncoding: 'gzip' };
      }
      return entry;
    };
    for (const [key, bytes] of input.files) await write(`normalized/${key}`, bytes, { contentType: key.endsWith('.geojson') ? 'application/geo+json' : 'application/json' });
    await write('normalized/manifest.json', input.manifestBytes);
    await write('redistribution.json', encode(REDISTRIBUTION));
    await write('representations.geojson', encode({ type: 'FeatureCollection', features: generated.nativeFeatures }), { contentType: 'application/geo+json', gzip: true });
    const coverage = { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'study-area', geometry: { type: 'Polygon', coordinates: [generated.studyRing] },
        properties: { role: 'study_selection_area_not_exhaustive_coverage', centre, radiusM, polygonSteps: TILE_POLICY.studyPolygonSteps,
          nominalRadialChordErrorM: radiusM * (1 - Math.cos(Math.PI / TILE_POLICY.studyPolygonSteps)) } },
      ...generated.tiles.map(tile => ({ type: 'Feature', id: tile.key, geometry: { type: 'Polygon', coordinates: [boundsRing(tileBounds(tile.z, tile.x, tile.y))] },
        properties: { role: 'indexed_payload_tile_not_safety_coverage', key: tile.key, zoom: tile.z, coverage: tile.coverage } })),
    ] };
    await write('coverage.geojson', encode(coverage), { contentType: 'application/geo+json', gzip: true });
    for (const tile of generated.tiles) {
      const collection = { type: 'FeatureCollection', features: tile.features };
      const bytes = encode(collection), entry = await write(tile.key, bytes, { contentType: 'application/geo+json', gzip: true });
      entries.push({ key: tile.key, z: tile.z, x: tile.x, y: tile.y, bbox: tileBounds(tile.z, tile.x, tile.y), coverage: tile.coverage,
        status: tile.features.length ? 'data' : 'empty', features: tile.features.length,
        classes: count(tile.features.map(f => f.properties.featureClass)), categories: count(tile.features.map(f => f.properties.category)),
        ...entry, gzipBytes: artifacts[`${tile.key}.gz`].bytes, gzipSha256: artifacts[`${tile.key}.gz`].sha256 });
    }
    const statistics = {
      sourceRecords: normalized.summary.sourceRecords, inputObservations: input.records.length,
      uniqueObservations: generated.index.uniqueObservations, exactDuplicates: generated.index.exactDuplicates,
      detailedRepresentations: generated.index.representations.length,
      confirmedIdentityGroups: generated.index.representations.filter(r => r.records.length > 1).length,
      physicalObjectCount: null, missingObservationIds: [],
      categories: count(input.records.map(r => r.category)), scopes: count(input.records.map(r => r.recordScope)),
      physicalStatuses: count(input.records.map(r => r.physicalStatus)), linkDecisions: count(input.links.map(l => l.decision)),
      exclusions: normalized.summary.excluded, exclusionRecords: input.parsed.get('excluded.json').length,
      divergences: input.parsed.get('divergences.json').length,
      levels: Object.fromEntries([TILE_POLICY.overviewZoom, TILE_POLICY.detailZoom].map(z => {
        const tiles = generated.tiles.filter(t => t.z === z), features = tiles.flatMap(t => t.features);
        return [z, { tiles: tiles.length, emptyTiles: tiles.filter(t => !t.features.length).length,
          featureOccurrences: features.length, lineFragments: features.filter(f => f.properties.fragmentOf).length,
          aggregates: features.filter(f => f.properties.representation === 'cartographic_aggregate').length,
          uniqueMemberObservations: new Set(features.flatMap(f => f.properties.memberObservationIds)).size }];
      })),
      tileBytes: entries.reduce((n, t) => n + t.bytes, 0), tileGzipBytes: entries.reduce((n, t) => n + t.gzipBytes, 0),
      payloadBytes: Object.values(artifacts).reduce((n, a) => n + a.bytes, 0),
    };
    const manifest = { schemaVersion: 1, dataset: `aeronautical-obstacles-${zone}-local-tiles`, zone, version, identity,
      sources: normalized.sources, sourceDates: normalized.sources.map(s => ({ id: s.id, referenceDate: s.referenceDate,
        airacCycle: s.airacCycle, snapshotAtUtc: s.snapshotAtUtc, retrievedAtUtc: s.retrievedAtUtc })),
      redistribution: REDISTRIBUTION, statistics, artifacts,
      coverage: { key: 'coverage.geojson', sha256: artifacts['coverage.geojson'].sha256, centre, radiusM,
        meaning: 'Study selection and indexed payload footprint only; not exhaustive obstacle coverage. Native traces may extend outside the circle.',
        outsideTiles: 'not covered, never implicitly empty' },
      tiling: { scheme: 'XYZ', format: 'GeoJSON, not MVT', zooms: [TILE_POLICY.overviewZoom, TILE_POLICY.detailZoom],
        emptyTiles: 'explicit_files', policy: TILE_POLICY, tiles: entries },
      identityPolicy: 'Only explicit confirmed possible_same_object links can share a display representation; original records and candidate links unchanged.',
      limitations: [...normalized.limitations, 'Low zoom counts are source records, never physical obstacle counts.',
        'Tile intersection vertices are 2D clipping only, not invented native routes or vertical profiles.',
        'No height-based omission; overview aggregates expose all members and unknown heights.',
        'No UI, offline cache, public redistribution or production performance validation.'],
    };
    const manifestBytes = encode(manifest);
    await writeFile(join(stage, 'manifest.json'), manifestBytes, { flag: 'wx' }); // Completion marker last.
    try { await lstat(output); throw new Error('IMMUTABLE_OUTPUT_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(stage, output);
    return { zone, output, version, ...statistics, manifestBytes: manifestBytes.length,
      totalBytes: statistics.payloadBytes + manifestBytes.length, elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      publicRedistributionValidated: false };
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      requireThat(['--source', '--output-root'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Usage: tile-build.mjs --source normalized-version-directory [--output-root directory-outside-git]');
      options[args[i]] = args[i + 1];
    }
    requireThat(options['--source'], 'NORMALIZED_SOURCE_REQUIRED');
    console.log(JSON.stringify(await buildTiles(options['--source'], options['--output-root']), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
