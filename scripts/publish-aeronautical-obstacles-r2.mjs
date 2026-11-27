#!/usr/bin/env node
/** Node-only publication tooling. No imports from this file belong in the application. */
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { createR2Client, readConfig as readSharedConfig, formatR2Error, CACHE_CONTROL } from './publish-osm-r2.mjs';
import { parseObstacleManifest, parseObstacleTile, canonical } from '../app/lib/aeronauticalObstacleTiles/contract.ts';
import { loadNormalized } from '../prototypes/aeronautical-obstacles/tile-build.mjs';
import { boundsRing } from '../prototypes/aeronautical-obstacles/tileGeometry.ts';

export const PREFIX = 'aeronautical-obstacles';
export const ACTIVE_CACHE = 'no-store';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const MAX_FILE = 64 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
const encode = value => Buffer.from(canonical(value) + '\n');
const missing = error => error?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(error?.name);
const conflict = error => error?.$metadata?.httpStatusCode === 412;

/** Reuse the tested S3 configuration/signing, never its electrical paths or manifests. */
export function readConfig(env = process.env) {
  const bucket = env.R2_BUCKET_AERONAUTICAL_OBSTACLES || env.R2_BUCKET_OSM_POWER_LINES;
  const publicBase = env.R2_OBSTACLES_PUBLIC_BASE_URL || env.R2_OSM_PUBLIC_BASE_URL;
  const origins = env.R2_OBSTACLES_CORS_ORIGINS || env.R2_OSM_CORS_ORIGINS;
  requireThat(bucket && publicBase && origins, 'OBSTACLES_R2_CONFIGURATION_MISSING: bucket, public URL or CORS origins');
  return readSharedConfig({ ...env, R2_BUCKET_OSM_POWER_LINES: bucket, R2_OSM_PUBLIC_BASE_URL: publicBase,
    R2_OSM_CORS_ORIGINS: origins, R2_OSM_PREFIX: PREFIX });
}

/** Reads exactly the unchanged 2A inventory; 2B validates the manifest and every tile. */
export async function buildPlan(source) {
  const root = await realpath(resolve(source)), rel = relative(REPO, root);
  requireThat(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel), 'SOURCE_MUST_BE_OUTSIDE_REPOSITORY');
  async function read(key) {
    requireThat(/^[a-zA-Z0-9_./-]+$/.test(key) && key.split('/').every(s => s && s !== '.' && s !== '..'), 'UNSAFE_ARTIFACT_PATH');
    const path = resolve(root, key), r = relative(root, path);
    requireThat(r && !r.startsWith('..') && !isAbsolute(r), 'UNSAFE_ARTIFACT_PATH');
    const stat = await lstat(path);
    requireThat(stat.isFile() && stat.size <= MAX_FILE && await realpath(path) === path, 'UNSAFE_OR_OVERSIZE_ARTIFACT');
    return readFile(path);
  }
  const manifestBody = await read('manifest.json'), manifestSha256 = sha(manifestBody);
  const manifest = await parseObstacleManifest(manifestBody, manifestSha256);
  requireThat(manifest.statistics.payloadBytes + manifestBody.length <= MAX_TOTAL
    && Object.values(manifest.artifacts).every(entry => entry.bytes <= MAX_FILE), 'PROTOTYPE_PAYLOAD_TOO_LARGE');
  requireThat(basename(root) === manifest.version.slice(0, 16), 'VERSION_DIRECTORY_MISMATCH');
  const normalized = await loadNormalized(join(root, 'normalized'));
  requireThat(normalized.manifest.version === manifest.identity.normalizedVersion && normalized.manifest.identity.zone === manifest.zone, 'NORMALIZED_IDENTITY_MISMATCH');
  const allowed = new Set(['normalized/manifest.json', ...normalized.files.keys()].map(k => k.startsWith('normalized/') ? k : `normalized/${k}`));
  for (const key of ['redistribution.json', 'coverage.geojson', 'representations.geojson']) allowed.add(key);
  for (const key of ['coverage.geojson.gz', 'representations.geojson.gz']) allowed.add(key);
  for (const tile of manifest.tiling.tiles) { allowed.add(tile.key); allowed.add(`${tile.key}.gz`); }
  requireThat(allowed.size === Object.keys(manifest.artifacts).length && Object.keys(manifest.artifacts).every(key => allowed.has(key)), 'ARTIFACT_ALLOWLIST_MISMATCH');
  const items = [], byKey = new Map(); let bytes = manifestBody.length;
  for (const [key, entry] of Object.entries(manifest.artifacts).sort(([a], [b]) => a.localeCompare(b))) {
    const rawKey = key.endsWith('.gz') ? key.slice(0, -3) : key;
    requireThat(key.endsWith('.gz') === (entry.contentEncoding === 'gzip')
      && entry.contentType === (rawKey.endsWith('.geojson') ? 'application/geo+json' : 'application/json'), `ARTIFACT_HTTP_METADATA_MISMATCH: ${key}`);
    const body = await read(key);
    requireThat(body.length === entry.bytes && sha(body) === entry.sha256, `LOCAL_SHA256_MISMATCH: ${key}`);
    bytes += body.length; requireThat(bytes <= MAX_TOTAL, 'PROTOTYPE_PAYLOAD_TOO_LARGE');
    if (entry.contentEncoding === 'gzip') {
      const decoded = gunzipSync(body, { maxOutputLength: MAX_FILE });
      const raw = manifest.artifacts[key.slice(0, -3)];
      requireThat(decoded.length === raw.bytes && sha(decoded) === raw.sha256 && raw.sha256 === entry.decodedSha256, `GZIP_INTEGRITY_MISMATCH: ${key}`);
    } else JSON.parse(body); // All 2A artifacts are JSON, including native/normalized ledgers.
    const item = { key, body, sha256: entry.sha256, contentType: entry.contentType, contentEncoding: entry.contentEncoding,
      decodedSha256: entry.decodedSha256 || entry.sha256, cacheControl: CACHE_CONTROL };
    items.push(item); byKey.set(key, item);
  }
  requireThat(canonical(JSON.parse(byKey.get('redistribution.json').body)) === canonical(manifest.redistribution), 'REDISTRIBUTION_LEDGER_MISMATCH');
  const coverage = JSON.parse(byKey.get('coverage.geojson').body), representations = JSON.parse(byKey.get('representations.geojson').body);
  requireThat(coverage.type === 'FeatureCollection' && Array.isArray(coverage.features) && coverage.features.length === manifest.tiling.tiles.length + 1
    && coverage.features[0].id === 'study-area' && coverage.features[0].geometry?.type === 'Polygon'
    && canonical(coverage.features[0].properties?.centre) === canonical(manifest.coverage.centre)
    && coverage.features[0].properties?.radiusM === manifest.coverage.radiusM, 'INVALID_COVERAGE_ARTIFACT');
  const footprints = new Map(coverage.features.slice(1).map(feature => [feature.id, feature]));
  requireThat(footprints.size === manifest.tiling.tiles.length && manifest.tiling.tiles.every(tile => {
    const feature = footprints.get(tile.key);
    return feature?.geometry?.type === 'Polygon' && canonical(feature.geometry.coordinates) === canonical([boundsRing(tile.bbox)])
      && feature.properties?.key === tile.key && feature.properties.coverage === tile.coverage;
  }), 'INVALID_TILE_COVERAGE_FOOTPRINT');
  requireThat(representations.type === 'FeatureCollection' && Array.isArray(representations.features) && representations.features.length === manifest.statistics.detailedRepresentations
    && representations.features.every(f => f?.type === 'Feature' && typeof f.id === 'string' && ['Point', 'LineString', 'MultiLineString'].includes(f.geometry?.type))
    && new Set(representations.features.map(f => f.id)).size === representations.features.length, 'INVALID_NATIVE_REPRESENTATIONS');
  for (const z of [9, 12]) {
    const members = new Set();
    for (const tile of manifest.tiling.tiles.filter(tile => tile.z === z)) {
      const data = await parseObstacleTile(byKey.get(tile.key).body, tile, manifest);
      for (const feature of data.features) for (const id of feature.properties.memberObservationIds) members.add(id);
    }
    requireThat(canonical([...members].sort()) === canonical([...new Set(normalized.records.map(r => r.observationId))].sort()), 'OBSERVATION_LOSS');
  }
  // Coverage first is the public/CORS canary. The immutable manifest is always last.
  items.sort((a, b) => a.key === 'coverage.geojson' ? -1 : b.key === 'coverage.geojson' ? 1 : a.key.localeCompare(b.key));
  items.push({ key: 'manifest.json', body: manifestBody, sha256: manifestSha256, decodedSha256: manifestSha256,
    contentType: 'application/json', cacheControl: CACHE_CONTROL });
  return { root, zone: manifest.zone, version: manifest.version, manifestSha256, manifest, items, bytes,
    inputScope: normalized.manifest.identity.scope ?? null };
}

export function summarize(plan, origins = 2) {
  const n = plan.items.length, classA = n + 2, classBUpperBound = 2 * n + 3 + 3 * origins * (n + 1);
  return { zone: plan.zone, version: plan.version, manifestSha256: plan.manifestSha256,
    prefix: `${PREFIX}/${plan.zone}/${plan.version}/`, immutableObjects: n, activeObjects: 1, tiles: plan.manifest.tiling.tiles.length,
    emptyTiles: plan.manifest.tiling.tiles.filter(t => t.status === 'empty').length, bytes: plan.bytes,
    tileBytes: plan.manifest.statistics.tileBytes, tileGzipBytes: plan.manifest.statistics.tileGzipBytes,
    inputScope: plan.inputScope, redistribution: plan.manifest.redistribution.mode,
    publicReady: false, blockers: [plan.inputScope && 'TEST_OR_SUBSET_NOT_A_PUBLIC_RELEASE', 'EXTERNAL_REDISTRIBUTION_REVIEW_REQUIRED'].filter(Boolean),
    estimate: { origins, classA, classBUpperBound, storageUSDPerMonth: plan.bytes / 1e9 * .015,
      operationsUSD: classA / 1e6 * 4.5 + classBUpperBound / 1e6 * .36,
      basis: 'R2 Standard marginal rates, before shared free tier and billable-unit rounding; no traffic forecast. Active JSON size excluded.' } };
}

/** External release review, not a mutation/upgrade of the LOCAL_PROTOTYPE_ONLY wire contract. */
export function validateApproval(plan, approval, now = Date.now()) {
  requireThat(approval?.schemaVersion === 1 && approval.zone === plan.zone && approval.version === plan.version
    && approval.manifestSha256 === plan.manifestSha256 && approval.redistributionApproved === true
    && approval.scope === 'all-listed-artifacts-including-normalized-originals'
    && typeof approval.reviewer === 'string' && approval.reviewer.trim()
    && typeof approval.reviewedAtUtc === 'string' && /Z$/.test(approval.reviewedAtUtc)
    && Number.isFinite(Date.parse(approval.reviewedAtUtc)) && Date.parse(approval.reviewedAtUtc) <= now, 'REDISTRIBUTION_APPROVAL_REQUIRED');
  requireThat(Array.isArray(approval.sources) && approval.sources.length === plan.manifest.sources.length
    && new Set(approval.sources.map(s => s.id)).size === approval.sources.length
    && plan.manifest.sources.every(source => approval.sources.some(s => s.id === source.id && s.sha256 === source.sha256
      && s.decision === 'approved' && typeof s.evidence === 'string' && s.evidence.trim() && typeof s.license === 'string' && s.license.trim())), 'SOURCE_RIGHTS_REVIEW_INCOMPLETE');
  requireThat(plan.inputScope === null, 'TEST_OR_SUBSET_NOT_A_PUBLIC_RELEASE');
}

const versionKey = (plan, item) => `${PREFIX}/${plan.zone}/${plan.version}/${item.key}`;
const activeKey = plan => `${PREFIX}/${plan.zone}/active.json`;
function descriptor(plan) { return { version: plan.version, manifestSha256: plan.manifestSha256 }; }
function validateActive(value, zone) {
  const valid = d => d && hash(d.version) && hash(d.manifestSha256);
  requireThat(value?.schemaVersion === 1 && value.kind === 'aeronautical-obstacles-release' && value.zone === zone
    && valid(value) && hash(value.approvalSha256) && (value.previous === null || valid(value.previous)) && typeof value.activatedAtUtc === 'string'
    && /Z$/.test(value.activatedAtUtc) && Number.isFinite(Date.parse(value.activatedAtUtc)), 'INVALID_ACTIVE_MANIFEST');
}
async function readBody(body, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > limit) { body.destroy?.(); throw new Error('REMOTE_BODY_TOO_LARGE'); }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function sameObject(remote, item) {
  return remote.ContentType === item.contentType && (remote.ContentEncoding || undefined) === item.contentEncoding
    && remote.CacheControl === item.cacheControl && remote.Metadata?.sha256 === item.sha256
    && remote.body.length === item.body.length && sha(remote.body) === item.sha256;
}

/** Fetch decodes gzip automatically; public validation uses the decoded hash, S3 uses stored bytes. */
export async function verifyPublic(config, key, item, fetcher = fetch) {
  const url = `${config.publicBase}/${key}`;
  for (const origin of config.origins) {
    const response = await fetcher(url, { headers: { Origin: origin }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
    try {
      requireThat(response.status === 200, `PUBLIC_HTTP_${response.status}: ${key}`);
      requireThat(['*', origin].includes(response.headers.get('access-control-allow-origin')), `PUBLIC_CORS_MISMATCH: ${key}`);
      requireThat(response.headers.get('content-type')?.split(';')[0].trim() === item.contentType
        && (response.headers.get('content-encoding') || undefined) === item.contentEncoding, `PUBLIC_HEADERS_MISMATCH: ${key}`);
      requireThat(response.headers.get('cache-control') === item.cacheControl, `PUBLIC_CACHE_MISMATCH: ${key}`);
      requireThat(sha(await readBody(response.body, MAX_FILE)) === item.decodedSha256, `PUBLIC_SHA256_MISMATCH: ${key}`);
    } finally { if (!response.bodyUsed) await response.body?.cancel(); }
    for (const method of ['GET', 'HEAD']) {
      const preflight = await fetcher(url, { method: 'OPTIONS', redirect: 'error', headers: { Origin: origin, 'Access-Control-Request-Method': method }, signal: AbortSignal.timeout(30000) });
      requireThat(preflight.ok && ['*', origin].includes(preflight.headers.get('access-control-allow-origin'))
        && preflight.headers.get('access-control-allow-methods')?.split(',').map(m => m.trim()).includes(method), `PUBLIC_PREFLIGHT_FAILED: ${key}`);
      await preflight.body?.cancel();
    }
  }
}

/** Read-only check by default. Only explicit publish/rollback can issue conditional PutObject. */
export async function runRemote(plan, config, { mode = 'check', approval, expectedActiveSha256, client, fetcher = fetch, now = () => new Date() } = {}) {
  requireThat(['check', 'publish', 'rollback'].includes(mode) && config.prefix === PREFIX, 'INVALID_PUBLICATION_MODE_OR_PREFIX');
  requireThat(plan.zone === plan.manifest.zone && plan.version === plan.manifest.version && plan.items.at(-1)?.key === 'manifest.json', 'PLAN_IDENTITY_MISMATCH');
  if (mode !== 'check') validateApproval(plan, approval, now().getTime());
  if (mode === 'rollback') requireThat(hash(expectedActiveSha256), 'ROLLBACK_EXPECTED_ACTIVE_REQUIRED');
  requireThat(plan.items.every(item => sha(item.body) === item.sha256) && sha(plan.items.at(-1).body) === plan.manifestSha256, 'PLAN_MUTATED');
  const r2 = client || createR2Client(config);
  async function send(command) {
    try { return await r2.send(command, { abortSignal: AbortSignal.timeout(30000) }); }
    catch (error) {
      // Retain control-flow status, but only a sanitized error and operation name.
      const redaction = { ...process.env, R2_ACCESS_KEY_ID: config.credentials?.accessKeyId ?? process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: config.credentials?.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY };
      throw Object.assign(new Error(`${command.constructor.name.replace('Command', '')}: ${formatR2Error(error, redaction)}`), {
        name: error?.name ?? 'R2Error', $metadata: { httpStatusCode: error?.$metadata?.httpStatusCode },
      });
    }
  }
  async function get(key, limit = MAX_FILE) {
    try { const remote = await send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return { ...remote, body: await readBody(remote.Body, limit) }; }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async function verifyStored(key, item) {
    requireThat(sameObject(await get(key) ?? {}, item), `REMOTE_INTEGRITY_MISMATCH: ${key}`);
  }
  async function put(key, item, condition) {
    await send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: item.body,
      ContentType: item.contentType, ContentEncoding: item.contentEncoding, CacheControl: item.cacheControl,
      Metadata: { sha256: item.sha256 }, ContentMD5: createHash('md5').update(item.body).digest('base64'), ...condition }));
  }
  try {
    await send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `${PREFIX}/${plan.zone}/`, MaxKeys: 1 }));
    let bucketCorsVerified = false;
    try {
      const cors = await send(new GetBucketCorsCommand({ Bucket: config.bucket }));
      requireThat(config.origins.every(origin => cors.CORSRules?.some(rule => (rule.AllowedOrigins?.includes('*') || rule.AllowedOrigins?.includes(origin))
        && ['GET', 'HEAD'].every(method => rule.AllowedMethods?.includes(method)))), 'BUCKET_CORS_NOT_READY');
      bucketCorsVerified = true;
    } catch (error) { if (!(error?.name === 'AccessDenied' && error?.$metadata?.httpStatusCode === 403)) throw error; }
    const current = await get(activeKey(plan), 16384);
    let active = null;
    if (current) {
      active = JSON.parse(current.body); validateActive(active, plan.zone);
      requireThat(sameObject(current, { body: current.body, sha256: sha(current.body), contentType: 'application/json', cacheControl: ACTIVE_CACHE })
        && /^"[^"\r\n]+"$/.test(current.ETag), 'ACTIVE_HEADERS_OR_INTEGRITY_MISMATCH');
    }
    if (mode === 'rollback') requireThat(active?.manifestSha256 === expectedActiveSha256
      && active.previous?.manifestSha256 === plan.manifestSha256 && active.previous.version === plan.version, 'ROLLBACK_TARGET_OR_ACTIVE_MISMATCH');
    const existing = new Set();
    // Scan every collision before the first write; metadata alone is not an integrity proof.
    for (const item of plan.items) {
      const remote = await get(versionKey(plan, item));
      if (remote) { requireThat(sameObject(remote, item), `REMOTE_VERSION_CONFLICT: ${item.key}`); existing.add(item.key); }
    }
    requireThat(!existing.has('manifest.json') || existing.size === plan.items.length, 'PUBLISHED_VERSION_INCOMPLETE');
    if (mode === 'check') {
      for (const item of plan.items.filter(item => existing.has(item.key))) await verifyPublic(config, versionKey(plan, item), item, fetcher);
      return { mode, objects: plan.items.length, existing: existing.size, missing: plan.items.length - existing.size,
        bucketCorsVerified, publicCorsVerified: existing.size > 0, writeAccessVerified: null };
    }
    requireThat(mode !== 'rollback' || existing.size === plan.items.length, 'ROLLBACK_RELEASE_INCOMPLETE');
    let uploaded = 0;
    for (const item of plan.items) {
      const key = versionKey(plan, item);
      if (!existing.has(item.key)) {
        try { await put(key, item, { IfNoneMatch: '*' }); uploaded++; }
        catch (error) { if (!conflict(error)) throw error; }
      }
      await verifyStored(key, item);
      // ALL payload objects, all origins, before the immutable manifest and active pointer.
      await verifyPublic(config, key, item, fetcher);
    }
    if (active?.manifestSha256 === plan.manifestSha256 && active.version === plan.version) {
      await verifyPublic(config, activeKey(plan), { body: current.body, decodedSha256: sha(current.body), contentType: 'application/json', cacheControl: ACTIVE_CACHE }, fetcher);
      return { mode, uploaded, reused: plan.items.length - uploaded, activation: 'UNCHANGED' };
    }
    const pointer = { schemaVersion: 1, kind: 'aeronautical-obstacles-release', zone: plan.zone, ...descriptor(plan),
      previous: active ? descriptor(active) : null, approvalSha256: sha(encode(approval)), activatedAtUtc: now().toISOString() };
    const body = encode(pointer), item = { body, sha256: sha(body), decodedSha256: sha(body), contentType: 'application/json', cacheControl: ACTIVE_CACHE };
    try { await put(activeKey(plan), item, current ? { IfMatch: current.ETag } : { IfNoneMatch: '*' }); }
    catch (error) {
      if (!conflict(error)) throw new Error(`ACTIVE_WRITE_FAILED_OR_UNCERTAIN: ${error.message}`);
      // A lost response followed by an SDK retry can return 412 after our own commit.
      if (!sameObject(await get(activeKey(plan)) ?? {}, item)) throw new Error('ACTIVE_CHANGED_CONCURRENTLY: immutable release retained, activation refused');
    }
    try { await verifyStored(activeKey(plan), item); await verifyPublic(config, activeKey(plan), item, fetcher); }
    catch (error) { throw new Error(`ACTIVE_WRITTEN_VERIFY_FAILED: ${error.message}`); }
    return { mode, uploaded, reused: plan.items.length - uploaded, activation: 'VERIFIED', active: pointer };
  } finally { if (!client) r2.destroy(); }
}

export async function main(args = process.argv.slice(2)) {
  let mode = 'dry-run', source, approvalPath, expectedActiveSha256; const modes = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--source', '--approval', '--expect-active-sha256'].includes(arg)) {
      const value = args[++i]; requireThat(value && !value.startsWith('--'), 'OPTION_VALUE_REQUIRED');
      if (arg === '--source') { requireThat(!source, 'DUPLICATE_SOURCE'); source = value; }
      else if (arg === '--approval') { requireThat(!approvalPath, 'DUPLICATE_APPROVAL'); approvalPath = value; }
      else { requireThat(!expectedActiveSha256, 'DUPLICATE_EXPECTED_ACTIVE'); expectedActiveSha256 = value; }
    } else if (['--dry-run', '--check', '--publish', '--rollback'].includes(arg)) modes.push(arg.slice(2));
    else throw new Error('USAGE: --source directory [--dry-run|--check|--publish|--rollback] [--approval review.json] [--expect-active-sha256 SHA256]');
  }
  requireThat(source && modes.length <= 1, 'SOURCE_REQUIRED_OR_CONFLICTING_MODES'); mode = modes[0] || mode;
  const plan = await buildPlan(source);
  console.log(JSON.stringify({ mode, ...summarize(plan) }, null, 2));
  if (mode === 'dry-run') return; // No env file, credential resolution, client or network.
  try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const approval = approvalPath ? JSON.parse(await readFile(approvalPath, 'utf8')) : undefined;
  console.log(JSON.stringify(await runRemote(plan, readConfig(), { mode, approval, expectedActiveSha256 }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(formatR2Error(error)); process.exitCode = 1;
});
