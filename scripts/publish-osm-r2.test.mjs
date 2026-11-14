import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildPlan, readConfig, runRemote, verifyPublic, CACHE_CONTROL } from './publish-osm-r2.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const encode = v => Buffer.from(JSON.stringify(v) + '\n');
const env = { R2_ACCOUNT_ID: '0'.repeat(32), R2_ACCESS_KEY_ID: 'test-only', R2_SECRET_ACCESS_KEY: 'test-only',
  R2_BUCKET_OSM_POWER_LINES: 'osm-pilot', R2_OSM_PUBLIC_BASE_URL: 'https://tiles.example.test', R2_OSM_CORS_ORIGINS: 'https://app.example.test' };
async function fixture(fn, { dataset = 'belgium', tileCount = 2 } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'bc-r2-publication-'));
  try {
    let source = join(temp, dataset, `20261108-${'a'.repeat(16)}`);
    await mkdir(source, { recursive: true });
    const coverage = encode({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } });
    const data = encode({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'way/1', properties: { power: 'line', voltage_max_v: 63000 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] });
    const empty = encode({ type: 'FeatureCollection', features: [] });
    const tiles = [], zoom = tileCount > 2 ? 14 : 1;
    for (let x = 0; x < tileCount; x++) {
      const body = x % 2 ? empty : data;
      const key = `tiles/${zoom}/${x}/0.geojson`, gzip = gzipSync(body);
      await mkdir(join(source, `tiles/${zoom}/${x}`), { recursive: true });
      await writeFile(join(source, key), body); await writeFile(join(source, `${key}.gz`), gzip);
      tiles.push({ key, bytes: body.length, gzip_bytes: gzip.length, sha256: sha(body), features: x % 2 ? 0 : 1, status: x % 2 ? 'empty' : 'data' });
    }
    const m = { schema_version: 2, dataset, country_profile: { code: dataset === 'france' ? 'FR' : 'BE' }, version: `20261108-${'a'.repeat(16)}`,
      version_sha256: 'a'.repeat(64), generator_sha256: 'b'.repeat(64), dataset_sha256: sha(data),
      sources: [{ id: dataset, url: `https://download.geofabrik.de/europe/${dataset}-latest.osm.pbf`, sha256: 'c'.repeat(64), snapshot_at_utc: '2026-11-08T21:21:00Z' }],
      coverage: { key: 'coverage.geojson', sha256: sha(coverage), polygon_input_sha256: 'd'.repeat(64) }, filter: { power: 'line', min_voltage_v: 63000 },
      statistics: { features: 1, geojson_bytes: data.length, tiles: tileCount, empty_tiles: Math.floor(tileCount / 2), tiles_bytes: tiles.reduce((sum, t) => sum + t.bytes, 0), tiles_gzip_bytes: tiles.reduce((sum, t) => sum + t.gzip_bytes, 0) },
      tiling: { scheme: 'XYZ', zoom, empty_tiles: 'explicit_files', tiles } };
    m.version_sha256 = sha(encode({ schema_version: 2, dataset: m.dataset, profile: m.country_profile, zoom: m.tiling.zoom,
      inputs: m.sources, coverage_sha256: m.coverage.polygon_input_sha256, generator_sha256: m.generator_sha256, min_voltage_v: m.filter.min_voltage_v }));
    m.version = `20261108-${m.version_sha256.slice(0, 16)}`;
    const versioned = join(temp, dataset, m.version); await rename(source, versioned); source = versioned;
    for (const [key, body] of [['coverage.geojson', coverage], ['power-lines.geojson', data], ['power-lines.geojson.gz', gzipSync(data)], ['manifest.json', encode(m)]]) await writeFile(join(source, key), body);
    await fn(source, m);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
const absent = () => Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
function remote(config, { denied = false, badCors = false, conflict = false, corsDenied = false } = {}) {
  const objects = new Map(), writes = [];
  return { writes, objects,
    client: { async send(command) {
      const name = command.constructor.name, p = command.input;
      if (name === 'HeadBucketCommand') { if (denied) throw new Error('AccessDenied'); return {}; }
      if (name === 'GetBucketCorsCommand') {
        if (corsDenied) throw Object.assign(new Error('Bucket configuration access denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
        return { CORSRules: badCors ? [] : [{ AllowedOrigins: config.origins, AllowedMethods: ['GET', 'HEAD'] }] };
      }
      if (name === 'HeadObjectCommand') {
        if (conflict) return { Metadata: { sha256: 'wrong' } };
        const item = objects.get(p.Key); if (!item) throw absent();
        return { ContentLength: item.Body.length, Metadata: item.Metadata, ContentType: item.ContentType,
          ContentEncoding: item.ContentEncoding, CacheControl: item.CacheControl, ETag: `"${createHash('md5').update(item.Body).digest('hex')}"` };
      }
      if (name === 'PutObjectCommand') { assert.equal(p.IfNoneMatch, '*'); assert.equal(p.CacheControl, CACHE_CONTROL);
        assert.equal(p.ContentMD5, createHash('md5').update(p.Body).digest('base64')); objects.set(p.Key, p); writes.push(p.Key); return {}; }
      throw new Error(`Unexpected command ${name}`);
    } },
    async fetcher(url, options) {
      const key = url.replace(`${config.publicBase}/`, ''); const object = objects.get(key); assert.ok(object, 'Public checks must occur after object exists');
      const headers = { 'access-control-allow-origin': options.headers.Origin, 'access-control-allow-methods': 'GET, HEAD',
        'content-type': object.ContentType, 'cache-control': object.CacheControl };
      return new Response(options.method === 'OPTIONS' ? null : object.ContentEncoding === 'gzip' ? gunzipSync(object.Body) : object.Body, { status: 200, headers });
    } };
}

test('configuration must be explicit; never reuse the private flight-track bucket', () => {
  assert.throws(() => readConfig({}), /CONFIGURATION_MISSING/);
  assert.throws(() => readConfig({ ...env, R2_BUCKET_FLIGHT_TRACKS: env.R2_BUCKET_OSM_POWER_LINES }), /PRIVATE_FLIGHT_TRACK_BUCKET_REFUSED/);
});
test('local plan preserves exact paths, explicit empty files, and rejects corruption/traversal', async () => fixture(async (source, m) => {
  const plan = await buildPlan(source); assert.equal(plan.items.length, 8); assert.equal(plan.items.at(-1).key, 'manifest.json');
  assert.ok(plan.items.some(i => i.key === 'tiles/1/1/0.geojson.gz'));
  const key = m.tiling.tiles[0].key;
  await writeFile(join(source, key), 'corrupt'); await assert.rejects(buildPlan(source), /SHA256_MISMATCH/);
  m.tiling.tiles[0].key = '../secret.geojson'; await writeFile(join(source, 'manifest.json'), encode(m));
  await assert.rejects(buildPlan(source), /UNSAFE_XYZ_KEY/);
}));
test('bucket denial, missing CORS, or a remote conflict blocks every upload', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env);
  for (const state of [{ denied: true }, { badCors: true }, { conflict: true }]) {
    const fake = remote(config, state);
    await assert.rejects(runRemote(plan, config, { publish: true, ...fake })); assert.deepEqual(fake.writes, []);
  }
}));
test('check is read-only; publication verifies canary/CORS and commits manifest last; retry skips identical objects', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env), fake = remote(config);
  await runRemote(plan, config, fake); assert.deepEqual(fake.writes, []);
  const result = await runRemote(plan, config, { publish: true, ...fake });
  assert.equal(result.uploaded, 8); assert.equal(result.publicUrlsVerified.length, 5);
  assert.match(fake.writes[0], /\/coverage.geojson$/); assert.match(fake.writes.at(-1), /\/manifest.json$/);
  assert.ok(fake.writes.every(key => key.startsWith(`osm-power-lines/belgium/${plan.version}/`)));
  const retry = await runRemote(plan, config, { publish: true, ...fake }); assert.equal(retry.uploaded, 0);
}));
test('failed public CORS stops at the canary; unapproved countries and mismatched profiles stay blocked', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env), fake = remote(config);
  await assert.rejects(runRemote(plan, config, { publish: true, ...fake, fetcher: async () => new Response('no cors') }), /PUBLIC_CORS_MISMATCH/);
  assert.equal(fake.writes.length, 1); assert.match(fake.writes[0], /coverage.geojson$/);
  await assert.rejects(runRemote({ ...plan, dataset: 'morocco' }, config, { publish: true, ...fake }), /PUBLICATION_DATASET_NOT_ALLOWED/);
  await assert.rejects(runRemote({ ...plan, dataset: 'france' }, config, { publish: true, ...fake }), /PUBLICATION_COUNTRY_MISMATCH/);
}));


test('GetBucketCors AccessDenied defers CORS to mandatory public verification without weakening other guards', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env), fake = remote(config, { corsDenied: true });
  const logs = [];
  const checked = await runRemote(plan, config, { ...fake, log: value => logs.push(value) });
  assert.equal(checked.corsVerified, false); assert.equal(checked.corsVerification, 'DEFERRED_PUBLIC_URL');
  assert.equal(logs[0].corsVerified, false); assert.equal(logs[0].corsVerification, 'DEFERRED_PUBLIC_URL');
  assert.deepEqual(fake.writes, []);
  const result = await runRemote(plan, config, { publish: true, ...fake });
  assert.equal(result.corsVerified, true); assert.equal(result.corsVerification, 'PUBLIC_URL');
  assert.equal(result.publicUrlsVerified.length, 5);
  assert.equal(fake.writes.length, 8); assert.match(fake.writes.at(-1), /manifest.json$/);
  const failedPublic = remote(config, { corsDenied: true });
  await assert.rejects(runRemote(plan, config, { publish: true, ...failedPublic,
    fetcher: async () => new Response('missing CORS') }), /PUBLIC_CORS_MISMATCH/);
  assert.equal(failedPublic.writes.length, 1); assert.match(failedPublic.writes[0], /coverage.geojson$/);
  for (const state of [{ denied: true }, { badCors: true }, { conflict: true, corsDenied: true }]) {
    const blocked = remote(config, state);
    await assert.rejects(runRemote(plan, config, { publish: true, ...blocked }));
    assert.deepEqual(blocked.writes, []);
  }
  for (const [status, name] of [[500, 'ServiceUnavailable'], [403, 'Unknown'], [401, 'AccessDenied']]) {
    const blocked = remote(config); const original = blocked.client.send;
    blocked.client.send = command => {
      if (command.constructor.name === 'GetBucketCorsCommand') throw Object.assign(new Error('not eligible for deferral'), { name, $metadata: { httpStatusCode: status } });
      return original(command);
    };
    await assert.rejects(runRemote(plan, config, { publish: true, ...blocked }));
    assert.deepEqual(blocked.writes, []);
  }
}));


test('public CORS observed GET 200 without allow-origin and OPTIONS 403 remain blocking', async () => fixture(async source => {
  const plan = await buildPlan(source), baseConfig = readConfig(env);
  const item = plan.items.find(item => item.key === 'coverage.geojson');
  for (const origin of ['https://www.balloon-companion.com', 'https://balloon-companion.com']) {
    const config = { ...baseConfig, origins: [origin] };
    for (const stage of ['missing-allow-origin', 'denied-options', 'configured']) {
      const methods = [];
      const fetcher = async (url, options) => {
        const method = options.method || 'GET'; methods.push(method);
        assert.equal(url, `${config.publicBase}/osm-power-lines/belgium/${plan.version}/coverage.geojson`);
        assert.equal(options.headers.Origin, origin);
        assert.equal(options.redirect, 'error');
        const headers = { vary: 'Origin', 'content-type': 'application/geo+json', 'cache-control': CACHE_CONTROL };
        if (stage !== 'missing-allow-origin') headers['access-control-allow-origin'] = origin;
        if (method === 'OPTIONS') {
          assert.equal(options.headers['Access-Control-Request-Method'], 'GET');
          if (stage === 'denied-options') return new Response(null, { status: 403, headers: { vary: 'Origin' } });
          headers['access-control-allow-methods'] = 'GET, HEAD';
          return new Response(null, { status: 204, headers });
        }
        return new Response(item.body, { status: 200, headers });
      };
      if (stage === 'configured') {
        assert.equal((await verifyPublic(plan, config, [item], fetcher)).length, 1);
        assert.deepEqual(methods, ['GET', 'OPTIONS']);
      } else {
        await assert.rejects(verifyPublic(plan, config, [item], fetcher),
          stage === 'missing-allow-origin' ? /PUBLIC_CORS_MISMATCH/ : /PUBLIC_PREFLIGHT_FAILED/);
        assert.deepEqual(methods, stage === 'missing-allow-origin' ? ['GET'] : ['GET', 'OPTIONS']);
      }
    }
  }
}));


test('France resumes 9150 objects after an accepted PUT loses its response, without overwrites, manifest last', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env), fake = remote(config, { corsDenied: true });
  assert.equal(plan.dataset, 'france'); assert.equal(plan.items.length, 9150);
  assert.equal(plan.manifest.country_profile.code, 'FR');
  const original = fake.client.send; let interrupt = true;
  fake.client.send = async command => {
    const result = await original(command);
    if (command.constructor.name === 'PutObjectCommand' && interrupt && fake.writes.length === 3500) {
      interrupt = false; throw new Error('SIMULATED_CONNECTION_LOSS_AFTER_COMMIT');
    }
    return result;
  };
  await assert.rejects(runRemote(plan, config, { publish: true, ...fake }), /SIMULATED_CONNECTION_LOSS_AFTER_COMMIT/);
  assert.equal(fake.objects.size, 3500);
  assert.ok(![...fake.objects.keys()].some(key => key.endsWith('/manifest.json')));
  const committed = new Set(fake.writes), progress = [];
  const result = await runRemote(plan, config, { publish: true, ...fake, log: value => progress.push(value) });
  assert.equal(result.uploaded, 5650); assert.equal(result.reused, 3500);
  assert.equal(result.corsVerified, true); assert.equal(result.publicUrlsVerified.length, 5);
  assert.equal(fake.objects.size, 9150); assert.equal(new Set(fake.writes).size, 9150);
  assert.ok(fake.writes.slice(3500).every(key => !committed.has(key)));
  assert.ok(fake.writes.every(key => key.startsWith(`osm-power-lines/france/${plan.version}/`)));
  assert.match(fake.writes.at(-1), /\/manifest.json$/);
  assert.ok(progress.some(p => p.stage === 'preflight-objects' && p.existing > 0));
  assert.ok(progress.some(p => p.stage === 'upload' && p.reused > 0));
  const again = await runRemote(plan, config, { publish: true, ...fake });
  assert.equal(again.uploaded, 0); assert.equal(again.reused, 9150); assert.equal(fake.writes.length, 9150);
}, { dataset: 'france', tileCount: 4573 }));

test('France retains bucket, public CORS, hash integrity and conflict guards before committing a version', async () => fixture(async source => {
  const plan = await buildPlan(source), config = readConfig(env);
  for (const state of [{ denied: true }, { badCors: true }, { conflict: true }]) {
    const blocked = remote(config, state);
    await assert.rejects(runRemote(plan, config, { publish: true, ...blocked })); assert.deepEqual(blocked.writes, []);
  }
  const cors = remote(config, { corsDenied: true });
  await assert.rejects(runRemote(plan, config, { publish: true, ...cors, fetcher: async () => new Response('missing CORS') }), /PUBLIC_CORS_MISMATCH/);
  assert.equal(cors.writes.length, 1); assert.match(cors.writes[0], /coverage.geojson$/);
  assert.ok(![...cors.objects.keys()].some(key => key.endsWith('/manifest.json')));
  const integrity = remote(config);
  await assert.rejects(runRemote(plan, config, { publish: true, ...integrity, fetcher: async (url, options) => {
    const response = await integrity.fetcher(url, options);
    return options.method === 'OPTIONS' ? response : new Response('wrong data', { headers: response.headers });
  } }), /PUBLIC_SHA256_MISMATCH/);
  assert.equal(integrity.writes.length, 1);
  await writeFile(join(source, plan.manifest.tiling.tiles[0].key), 'corrupt');
  await assert.rejects(buildPlan(source), /SHA256_MISMATCH/);
}, { dataset: 'france' }));
