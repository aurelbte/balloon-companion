#!/usr/bin/env node
/** Offline plan by default. Explicit publication is limited to validated Belgium/France datasets. */
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, basename, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { S3Client, HeadBucketCommand, GetBucketCorsCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const COUNTRIES = new Set(['france', 'belgium', 'morocco', 'united-kingdom']);
const PUBLISH_COUNTRY_CODES = new Map([['belgium', 'BE'], ['france', 'FR'], ['morocco', 'MA']]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest();
function requireThat(condition, code) { if (!condition) throw new Error(code); }

export function readConfig(env = process.env) {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_OSM_POWER_LINES', 'R2_OSM_PUBLIC_BASE_URL', 'R2_OSM_CORS_ORIGINS'];
  const missing = required.filter(key => !env[key]?.trim());
  requireThat(!missing.length, `CONFIGURATION_MISSING: ${missing.join(', ')}`);
  for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    requireThat(!/[\s\x00-\x1f\x7f]/u.test(env[key]), `INVALID_S3_CREDENTIAL_WHITESPACE: ${key}`);
  }
  const bucket = env.R2_BUCKET_OSM_POWER_LINES;
  requireThat(bucket !== env.R2_BUCKET_FLIGHT_TRACKS, 'PRIVATE_FLIGHT_TRACK_BUCKET_REFUSED');
  requireThat(/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID), 'INVALID_R2_ACCOUNT_ID');
  requireThat(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'INVALID_BUCKET');
  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const api = new URL(endpoint);
  requireThat(api.protocol === 'https:' && !api.username && !api.password && !api.search && !api.hash
    && api.hostname.endsWith('.r2.cloudflarestorage.com') && api.hostname.split('.')[0] === env.R2_ACCOUNT_ID
    && api.pathname === '/' && !api.port, 'INVALID_R2_ENDPOINT');
  const publicUrl = new URL(env.R2_OSM_PUBLIC_BASE_URL);
  requireThat(publicUrl.protocol === 'https:' && !publicUrl.username && !publicUrl.password && !publicUrl.search && !publicUrl.hash
    && !publicUrl.hostname.endsWith('.r2.cloudflarestorage.com'), 'INVALID_PUBLIC_BASE_URL');
  const origins = [...new Set(env.R2_OSM_CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean))];
  requireThat(origins.length > 0 && origins.every(origin => {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  }), 'INVALID_CORS_ORIGINS');
  const prefix = env.R2_OSM_PREFIX || 'osm-power-lines';
  requireThat(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix), 'INVALID_PREFIX');
  return { bucket, endpoint, origins, prefix, publicBase: publicUrl.href.replace(/\/$/, ''),
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } };
}

// Keep operation context separately: never attach/log SDK request or credential objects.
const requestErrors = new WeakMap();
export function createR2Client(config, { requestHandler, maxAttempts = 3 } = {}) {
  return new S3Client({ region: 'auto', endpoint: config.endpoint, credentials: config.credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED', maxAttempts, ...(requestHandler ? { requestHandler } : {}) });
}

async function sendR2(client, command, config) {
  try { return await client.send(command); }
  catch (error) {
    if (error && typeof error === 'object') requestErrors.set(error, {
      operation: command.constructor.name.replace(/Command$/, ''),
      secrets: [config.credentials?.accessKeyId, config.credentials?.secretAccessKey],
    });
    throw error;
  }
}

/** Independent read-only diagnostic. Never used as a substitute for publication preflight. */
export async function diagnoseR2(plan, config, { client } = {}) {
  requireThat(COUNTRIES.has(plan.dataset) && /^\d{8}-[a-f0-9]{16}$/.test(plan.version), 'INVALID_DIAGNOSTIC_TARGET');
  const r2 = client || createR2Client(config);
  try {
    await sendR2(r2, new ListObjectsV2Command({ Bucket: config.bucket,
      Prefix: `${config.prefix}/${plan.dataset}/${plan.version}/`, MaxKeys: 1 }), config);
    // No Contents, object names, or raw response are returned or logged.
    return { mode: 'diagnose', operation: 'ListObjectsV2', listAccessVerified: true,
      writeAccessVerified: null, writeAccessStatus: 'NOT_TESTED',
      publicationPreflightPassed: null, publicationPreflightStatus: 'NOT_RUN',
      explanation: 'ListObjectsV2 verifies list access only. No write request or publication preflight was performed.' };
  } finally { if (!client) r2.destroy(); }
}

function responseDetails(error) {
  const body = error?.$responseBodyText ?? error?.$response?.body;
  const text = typeof body === 'string' ? body.slice(0, 32768)
    : body instanceof Uint8Array ? Buffer.from(body.subarray(0, 32768)).toString('utf8') : '';
  // Never consume a stream, dump HTML, or include raw XML (which can echo signed requests).
  try {
    const parsed = JSON.parse(text);
    const detail = parsed.Error ?? parsed.errors?.[0] ?? parsed;
    return { code: detail.Code ?? detail.code, message: detail.Message ?? detail.message, requestId: detail.RequestId };
  } catch { /* S3 normally returns XML. */ }
  const xml = tag => {
    const value = new RegExp(`<${tag}>(.*?)</${tag}>`, 's').exec(text)?.[1];
    return value?.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
      if (named[entity]) return named[entity];
      const number = entity.slice(2, -1);
      const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    });
  };
  return { code: xml('Code'), message: xml('Message'), requestId: xml('RequestId') };
}

/** Allowlisted response fields only; never dump an error, request, stack, or headers. */
export function formatR2Error(error, environment = process.env) {
  const context = requestErrors.get(error);
  const secrets = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_SESSION_TOKEN', 'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'CLOUDFLARE_API_TOKEN']
    .map(key => environment[key]).concat(context?.secrets || [])
    .flatMap(value => value ? [value, encodeURIComponent(value), Buffer.from(value).toString('base64')] : [])
    .sort((a, b) => b.length - a.length);
  const clean = (value, limit = 1200) => {
    let text = String(value ?? '');
    for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
    return text.replace(/https?:\/\/[^\s<>"']+/gi, '[URL REDACTED]')
      .replace(/AWS4-HMAC-SHA256[^\r\n]*/gi, '[AUTHORIZATION REDACTED]')
      .replace(/(?:CanonicalRequest|StringToSign)[\s\S]*/gi, '[SIGNING DATA REDACTED]')
      .replace(/\b(?:Credential|Signature|X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token)\s*=\s*[^\s,;<>"']+/gi, '[SIGNING DATA REDACTED]')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, limit);
  };
  const operation = context?.operation;
  if (!operation && !error?.$metadata && !error?.$response) return clean(error?.message || 'PUBLICATION_FAILED');
  const body = responseDetails(error);
  const header = name => Object.entries(error.$response?.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
  const meaningful = value => value && !['Unknown', 'UnknownError', 'UnknownError: Unknown'].includes(String(value));
  const candidate = clean([error.Code, error.Error?.Code, body.code, header('x-amz-error-code'), error.code, error.name]
    .find(meaningful) || 'Unknown', 128);
  const code = /^[a-zA-Z0-9_.-]+$/.test(candidate) ? candidate : 'Unknown';
  const message = [error.Error?.Message, error.Message, body.message, header('x-amz-error-message'), error.message].find(meaningful);
  const http = error.$metadata?.httpStatusCode ?? error.$response?.statusCode;
  const status = Number.isInteger(http) ? http : 'NETWORK';
  return `R2_REQUEST_FAILED_${status}_${code} ${JSON.stringify({ operation: operation || 'Unknown', code,
    detail: message ? clean(message) : "Cloudflare n'a fourni aucun détail exploitable ; une réponse HEAD peut être sans corps.",
    requestId: clean(error.$metadata?.requestId || error.RequestId || body.requestId || header('x-amz-request-id'), 128) || undefined,
    cfRay: clean(header('cf-ray'), 128) || undefined })}`;
}

/** Read-only, exact allowlist: never upload arbitrary neighbouring files, PBFs or environment files. */
export async function buildPlan(source) {
  const root = await realpath(resolve(source));
  async function read(key) {
    const path = resolve(root, key);
    const rel = relative(root, path);
    requireThat(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep), 'UNSAFE_LOCAL_PATH');
    requireThat((await lstat(path)).isFile() && await realpath(path) === path, 'SYMLINK_OR_NON_FILE_REFUSED');
    return readFile(path);
  }
  const manifestBytes = await read('manifest.json');
  const m = JSON.parse(manifestBytes);
  requireThat(m.schema_version === 2 && COUNTRIES.has(m.dataset), 'UNSUPPORTED_MANIFEST');
  requireThat(/^\d{8}-[a-f0-9]{16}$/.test(m.version) && m.version === basename(root) && m.dataset === basename(dirname(root)), 'VERSION_DIRECTORY_MISMATCH');
  requireThat([m.version_sha256, m.generator_sha256, m.dataset_sha256, m.coverage?.sha256].every(hash => /^[a-f0-9]{64}$/.test(hash))
    && m.version.endsWith(m.version_sha256.slice(0, 16)), 'INVALID_MANIFEST_HASHES');
  requireThat(m.filter?.power === 'line' && m.filter.min_voltage_v === 63000 && m.tiling?.scheme === 'XYZ'
    && m.tiling.empty_tiles === 'explicit_files' && Number.isInteger(m.tiling.zoom) && m.tiling.zoom >= 0 && m.tiling.zoom <= 22, 'UNSUPPORTED_FILTER_OR_TILING');
  requireThat(Array.isArray(m.sources) && m.sources.length > 0 && m.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)), 'MISSING_SOURCE_PROVENANCE');
  const identity = { schema_version: 2, dataset: m.dataset, profile: m.country_profile, zoom: m.tiling.zoom,
    inputs: m.sources.map(source => Object.fromEntries(['id', 'url', 'sha256', 'snapshot_at_utc'].map(key => [key, source[key]]))),
    coverage_sha256: m.coverage.polygon_input_sha256, generator_sha256: m.generator_sha256, min_voltage_v: m.filter.min_voltage_v };
  requireThat(sha256(Buffer.from(JSON.stringify(identity) + '\n')) === m.version_sha256, 'VERSION_IDENTITY_MISMATCH');
  const items = [];
  const seen = new Set();
  async function add(key, hash, size, { gzip = false, raw } = {}) {
    requireThat(!seen.has(key), 'DUPLICATE_OBJECT_KEY'); seen.add(key);
    const body = await read(key);
    requireThat(hash === undefined || sha256(body) === hash, `SHA256_MISMATCH: ${key}`);
    requireThat(size === undefined || body.length === size, `SIZE_MISMATCH: ${key}`);
    if (gzip) requireThat(gunzipSync(body, { maxOutputLength: raw.length + 1 }).equals(raw), `GZIP_MISMATCH: ${key}`);
    items.push({ key, body, sha256: sha256(body), md5: md5(body).toString('hex'),
      contentType: key === 'manifest.json' ? 'application/json' : 'application/geo+json',
      contentEncoding: gzip ? 'gzip' : undefined, decodedSha256: sha256(gzip ? raw : body) });
    return body;
  }
  requireThat(m.coverage?.key === 'coverage.geojson', 'UNSAFE_COVERAGE_KEY');
  await add('coverage.geojson', m.coverage.sha256);
  const dataset = await add('power-lines.geojson', m.dataset_sha256, m.statistics.geojson_bytes);
  const collection = JSON.parse(dataset);
  requireThat(collection.type === 'FeatureCollection' && collection.features.length === m.statistics.features
    && new Set(collection.features.map(f => f.id)).size === collection.features.length
    && collection.features.every(f => f.properties?.power === 'line' && f.properties.voltage_max_v >= 63000
      && [undefined, null, '', 'overhead'].includes(f.properties.location)), 'DATASET_COUNT_OR_FILTER_OR_DUPLICATES');
  await add('power-lines.geojson.gz', undefined, undefined, { gzip: true, raw: dataset });
  requireThat(Array.isArray(m.tiling.tiles) && m.tiling.tiles.length > 0, 'NO_TILES');
  let empty = 0, bytes = 0, gzipBytes = 0;
  for (const tile of m.tiling.tiles) {
    const match = /^tiles\/(\d+)\/(\d+)\/(\d+)\.geojson$/.exec(tile.key);
    requireThat(match && Number(match[1]) === m.tiling.zoom && [match[2], match[3]].every(n => Number(n) < 2 ** m.tiling.zoom), 'UNSAFE_XYZ_KEY');
    const raw = await add(tile.key, tile.sha256, tile.bytes);
    const features = JSON.parse(raw);
    requireThat(features.type === 'FeatureCollection' && features.features.length === tile.features
      && new Set(features.features.map(f => f.id)).size === tile.features
      && tile.status === (tile.features ? 'data' : 'empty'), `TILE_CONTENT_MISMATCH: ${tile.key}`);
    await add(`${tile.key}.gz`, undefined, tile.gzip_bytes, { gzip: true, raw });
    empty += Number(tile.features === 0); bytes += raw.length; gzipBytes += tile.gzip_bytes;
  }
  requireThat(m.statistics.tiles === m.tiling.tiles.length && m.statistics.empty_tiles === empty
    && m.statistics.tiles_bytes === bytes && m.statistics.tiles_gzip_bytes === gzipBytes, 'TILE_STATISTICS_MISMATCH');
  await add('manifest.json'); // Commit marker last; bytes are never rewritten.
  return { dataset: m.dataset, version: m.version, items, manifest: m,
    bytes: items.reduce((sum, item) => sum + item.body.length, 0) };
}

const isMissing = error => error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name);
function remoteMatches(head, item) {
  return Number(head.ContentLength) === item.body.length && head.Metadata?.sha256 === item.sha256
    && head.ContentType === item.contentType && (head.ContentEncoding || undefined) === item.contentEncoding
    && head.CacheControl === CACHE_CONTROL && head.ETag?.replaceAll('"', '') === item.md5;
}
function keyFor(config, plan, item) { return `${config.prefix}/${plan.dataset}/${plan.version}/${item.key}`; }
function publicUrl(config, plan, item) { return `${config.publicBase}/${keyFor(config, plan, item)}`; }

export async function verifyPublic(plan, config, items, fetcher = fetch) {
  const urls = [];
  for (const item of items) {
    const url = publicUrl(config, plan, item);
    for (const origin of config.origins) {
      const response = await fetcher(url, { headers: { Origin: origin }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      requireThat(response.status === 200, `PUBLIC_HTTP_${response.status}`);
      requireThat(['*', origin].includes(response.headers.get('access-control-allow-origin')), 'PUBLIC_CORS_MISMATCH');
      requireThat(response.headers.get('content-type')?.split(';')[0].trim() === item.contentType, 'PUBLIC_CONTENT_TYPE_MISMATCH');
      requireThat(response.headers.get('cache-control')?.includes('immutable') && response.headers.get('cache-control')?.includes('max-age=31536000'), 'PUBLIC_CACHE_MISMATCH');
      // fetch transparently decodes Content-Encoding (including .geojson.gz).
      requireThat(sha256(Buffer.from(await response.arrayBuffer())) === item.decodedSha256, 'PUBLIC_SHA256_MISMATCH');
      const options = await fetcher(url, { method: 'OPTIONS', redirect: 'error', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' }, signal: AbortSignal.timeout(30000) });
      requireThat(options.ok && ['*', origin].includes(options.headers.get('access-control-allow-origin'))
        && options.headers.get('access-control-allow-methods')?.split(',').some(m => m.trim() === 'GET'), 'PUBLIC_PREFLIGHT_FAILED');
    }
    urls.push(url);
  }
  return urls;
}

/** Check-only does not write. Publication never creates buckets or changes bucket/CORS/public settings. */
export async function runRemote(plan, config, { publish = false, client, fetcher = fetch, log = () => {} } = {}) {
  if (publish) {
    requireThat(PUBLISH_COUNTRY_CODES.has(plan.dataset), 'PUBLICATION_DATASET_NOT_ALLOWED');
    requireThat(plan.manifest.country_profile?.code === PUBLISH_COUNTRY_CODES.get(plan.dataset), 'PUBLICATION_COUNTRY_MISMATCH');
  }
  const r2 = client || createR2Client(config);
  const send = command => sendR2(r2, command, config);
  try {
    await send(new HeadBucketCommand({ Bucket: config.bucket }));
    let corsVerified = false;
    try {
      const cors = await send(new GetBucketCorsCommand({ Bucket: config.bucket }));
      for (const origin of config.origins) requireThat(cors.CORSRules?.some(rule =>
        (rule.AllowedOrigins?.includes('*') || rule.AllowedOrigins?.includes(origin))
        && ['GET', 'HEAD'].every(method => rule.AllowedMethods?.includes(method))), 'BUCKET_CORS_NOT_READY');
      corsVerified = true;
    } catch (error) {
      // Bucket configuration may require admin rights; object-only tokens still need public CORS verification.
      const denied = error?.$metadata?.httpStatusCode === 403
        && [error.name, error.Code, error.Error?.Code].includes('AccessDenied');
      if (!denied) throw error;
    }
    const corsVerification = corsVerified ? 'BUCKET_POLICY' : 'DEFERRED_PUBLIC_URL';
    const existing = new Set();
    let checked = 0;
    // All collisions are checked before the first write, including the final manifest.
    for (const item of plan.items) {
      const Key = keyFor(config, plan, item);
      try {
        const head = await send(new HeadObjectCommand({ Bucket: config.bucket, Key }));
        requireThat(remoteMatches(head, item), `REMOTE_VERSION_CONFLICT: ${item.key}`);
        existing.add(Key);
      } catch (error) { if (!isMissing(error)) throw error; }
      if (++checked % 250 === 0) log({ stage: 'preflight-objects', checked, total: plan.items.length, existing: existing.size });
    }
    log({ stage: 'preflight', bucketVerified: true, corsVerified, corsVerification, objects: plan.items.length, existing: existing.size });
    if (!publish) return { mode: 'check', corsVerified, corsVerification, objects: plan.items.length, existing: existing.size };
    let uploaded = 0, processed = 0;
    for (const item of plan.items) {
      const Key = keyFor(config, plan, item);
      if (!existing.has(Key)) {
        try {
          await send(new PutObjectCommand({ Bucket: config.bucket, Key, Body: item.body,
            ContentType: item.contentType, ContentEncoding: item.contentEncoding, CacheControl: CACHE_CONTROL,
            ContentMD5: Buffer.from(item.md5, 'hex').toString('base64'), Metadata: { sha256: item.sha256 }, IfNoneMatch: '*' }));
          uploaded++;
        } catch (error) { if (error?.$metadata?.httpStatusCode !== 412) throw error; }
      }
      requireThat(remoteMatches(await send(new HeadObjectCommand({ Bucket: config.bucket, Key })), item), `REMOTE_VERIFY_FAILED: ${item.key}`);
      // The coverage object doubles as an access/public/CORS canary before bulk upload.
      if (item.key === 'coverage.geojson') await verifyPublic(plan, config, [item], fetcher);
      if (++processed % 50 === 0) log({ stage: 'upload', processed, uploaded, reused: processed - uploaded, total: plan.items.length });
    }
    const tile = plan.manifest.tiling.tiles.find(t => t.status === 'data');
    const empty = plan.manifest.tiling.tiles.find(t => t.status === 'empty');
    const sampleKeys = ['manifest.json', 'coverage.geojson', tile?.key, empty?.key, tile && `${tile.key}.gz`].filter(Boolean);
    const urls = await verifyPublic(plan, config, plan.items.filter(item => sampleKeys.includes(item.key)), fetcher);
    return { mode: 'published', uploaded, reused: plan.items.length - uploaded, corsVerified: true, corsVerification: 'PUBLIC_URL', publicUrlsVerified: urls };
  } finally { if (!client) r2.destroy(); }
}

export async function main(args = process.argv.slice(2)) {
  let source, mode = 'dry-run'; const modes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') source = args[++i];
    else if (['--dry-run', '--check', '--publish', '--diagnose'].includes(args[i])) modes.push(args[i].slice(2));
    else throw new Error('USAGE: --source /outside-git/country/version [--dry-run | --check | --publish | --diagnose]');
  }
  requireThat(source && modes.length <= 1, 'SOURCE_REQUIRED_OR_CONFLICTING_MODES');
  mode = modes[0] || mode;
  const plan = await buildPlan(source);
  console.log(JSON.stringify({ mode, dataset: plan.dataset, version: plan.version, objects: plan.items.length, bytes: plan.bytes, tiles: plan.manifest.statistics.tiles }));
  if (mode === 'dry-run') return;
  // Load the same server variable names as the application; never log credential values.
  try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = readConfig();
  if (mode === 'diagnose') {
    console.log(JSON.stringify(await diagnoseR2(plan, config)));
    return;
  }
  console.log(JSON.stringify(await runRemote(plan, config, { publish: mode === 'publish', log: data => console.log(JSON.stringify(data)) })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(formatR2Error(error)); process.exitCode = 1;
  });
}
