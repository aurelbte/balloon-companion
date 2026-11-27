import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFile, writeFile, cp, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { datasets } from '../app/lib/aeronauticalObstacleTiles/runtime.fixtures.mjs';
import { buildTiles } from '../prototypes/aeronautical-obstacles/tile-build.mjs';
import { canonical } from '../app/lib/aeronauticalObstacleTiles/contract.ts';
import { AeronauticalObstacleTileRuntime } from '../app/lib/aeronauticalObstacleTiles/runtime.ts';
import { buildPlan, readConfig, summarize, validateApproval, runRemote, PREFIX, ACTIVE_CACHE } from './publish-aeronautical-obstacles-r2.mjs';
import { formatR2Error } from './publish-osm-r2.mjs';

let data, plans, second;
const sha = b => createHash('sha256').update(b).digest('hex');
const fail = (status, name = 'Failure') => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
before(async () => {
  data = await datasets(); plans = {};
  for (const zone of ['preuseville', 'le-havre', 'grenoble']) plans[zone] = await buildPlan(data[zone].output);
  const input = join(data.root, 'second-normalized'); await cp(join(data.root, 'preuseville-input'), input, { recursive: true });
  const m = JSON.parse(await readFile(join(input, 'manifest.json'))); m.identity.protocolTestRevision = 'second-version';
  m.version = sha(canonical(m.identity)); await writeFile(join(input, 'manifest.json'), canonical(m) + '\n');
  second = await buildPlan((await buildTiles(input, join(data.root, 'second-tiles'))).output);
});
after(async () => { if (data) await rm(data.root, { recursive: true, force: true }); });

const approval = plan => ({ schemaVersion: 1, zone: plan.zone, version: plan.version, manifestSha256: plan.manifestSha256,
  redistributionApproved: true, scope: 'all-listed-artifacts-including-normalized-originals', reviewer: 'MOCK REVIEWER — TEST ONLY',
  reviewedAtUtc: '2000-01-01T00:00:00Z', sources: plan.manifest.sources.map(s => ({ id: s.id, sha256: s.sha256,
    decision: 'approved', license: 'TEST ONLY', evidence: 'Mock evidence for local protocol tests, not a legal approval' })) });
// Only the transport tests simulate a fully restored/reviewed input. Real CLI fixture plans
// retain their test/subset marker and are tested to be unpublishable below. Never a CLI flag.
const protocolPlan = plan => ({ ...plan, inputScope: null });
const keyFor = (plan, key) => `${PREFIX}/${plan.zone}/${plan.version}/${key}`;
const pointerKey = plan => `${PREFIX}/${plan.zone}/active.json`;

async function localRemote(t) {
  const objects = new Map(), calls = [], requests = [];
  let s3Hook, httpHook;
  const client = { async send(command) {
    const op = command.constructor.name, p = command.input; calls.push({ op, key: p.Key });
    const hooked = await s3Hook?.(op, p); if (hooked !== undefined) return hooked;
    if (op === 'ListObjectsV2Command') return {};
    if (op === 'GetBucketCorsCommand') throw fail(403, 'AccessDenied');
    const old = objects.get(p.Key);
    if (op === 'GetObjectCommand') { if (!old) throw fail(404, 'NoSuchKey'); return { ...old, Body: Readable.from([old.bytes]) }; }
    assert.equal(op, 'PutObjectCommand');
    if (p.IfNoneMatch === '*' && old || p.IfMatch && p.IfMatch !== old?.ETag) throw fail(412, 'PreconditionFailed');
    assert.ok(p.Key.startsWith(PREFIX + '/')); assert.ok(p.IfNoneMatch === '*' || p.IfMatch);
    const bytes = Buffer.from(p.Body);
    assert.equal(createHash('md5').update(bytes).digest('base64'), p.ContentMD5);
    objects.set(p.Key, { bytes, ContentType: p.ContentType, ContentEncoding: p.ContentEncoding,
      ContentLength: bytes.length, CacheControl: p.CacheControl, Metadata: p.Metadata, ETag: `"${sha(bytes)}"` });
    return { ETag: objects.get(p.Key).ETag };
  } };
  const server = createServer(async (req, res) => {
    const key = new URL(req.url, 'http://localhost').pathname.slice(1); requests.push({ key, method: req.method, requestedMethod: req.headers['access-control-request-method'] });
    if (await httpHook?.(key, req, res)) return;
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
    if (req.method === 'OPTIONS') {
      // Valid CORS servers may return only the requested method, not the whole policy.
      res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
      res.writeHead(204).end(); return;
    }
    const item = objects.get(key); if (!item) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', item.ContentType); res.setHeader('Cache-Control', item.CacheControl);
    if (item.ContentEncoding) res.setHeader('Content-Encoding', item.ContentEncoding);
    res.setHeader('Content-Length', item.bytes.length); res.end(item.bytes);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const config = { bucket: 'local-protocol-test-only', prefix: PREFIX, publicBase: `http://127.0.0.1:${server.address().port}`,
    origins: ['https://www.balloon-companion.com', 'https://balloon-companion.com'] };
  return { objects, calls, requests, config, client, hookS3(fn) { s3Hook = fn; }, hookHTTP(fn) { httpHook = fn; } };
}
const publish = (remote, plan = protocolPlan(plans.preuseville)) => runRemote(plan, remote.config, { client: remote.client, mode: 'publish', approval: approval(plan) });

test('2A and 2B artifacts, raw/gzip checksums, explicit empties, both LODs and sizes are reused unchanged', async () => {
  for (const zone of Object.keys(plans)) {
    const p = plans[zone], s = summarize(p);
    assert.equal(p.items.at(-1).key, 'manifest.json'); assert.equal(p.items[0].key, 'coverage.geojson');
    assert.equal(s.bytes, p.items.reduce((n, i) => n + i.body.length, 0));
    assert.equal(s.immutableObjects, Object.keys(p.manifest.artifacts).length + 1);
    assert.ok(s.emptyTiles > 0); assert.deepEqual(p.manifest.tiling.zooms, [9, 12]);
    assert.ok(s.prefix.startsWith(`${PREFIX}/${zone}/`)); assert.equal(s.publicReady, false);
    assert.ok(p.items.some(i => i.contentEncoding === 'gzip')); assert.ok(s.estimate.storageUSDPerMonth > 0);
  }
});

test('actual CLI dry-run has no credentials, client, network or writes; rights and synthetic/subset blockers remain explicit', async () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    'scripts/publish-aeronautical-obstacles-r2.mjs', '--source', data['le-havre'].output, '--dry-run'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, 'dry-run'); assert.equal(parsed.publicReady, false);
  for (const plan of Object.values(plans)) {
    assert.throws(() => validateApproval(plan), /APPROVAL_REQUIRED/);
    assert.throws(() => validateApproval(plan, approval(plan)), /TEST_OR_SUBSET/);
  }
  const p = protocolPlan(plans.preuseville); validateApproval(p, approval(p));
  assert.throws(() => validateApproval(p, { ...approval(p), manifestSha256: '0'.repeat(64) }), /APPROVAL_REQUIRED/);
  assert.throws(() => validateApproval(p, { ...approval(p), sources: [] }), /SOURCE_RIGHTS_REVIEW_INCOMPLETE/);
});

test('configuration reuses S3 settings but pins a separate prefix, refuses private buckets and never exposes secrets', () => {
  const env = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'test-access-key', R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET_OSM_POWER_LINES: 'test-bucket', R2_OSM_PUBLIC_BASE_URL: 'https://public.invalid', R2_OSM_CORS_ORIGINS: 'https://example.com',
    R2_OSM_PREFIX: 'osm-power-lines' };
  const config = readConfig(env); assert.equal(config.prefix, PREFIX); assert.equal(config.bucket, 'test-bucket');
  assert.throws(() => readConfig({ ...env, R2_BUCKET_FLIGHT_TRACKS: 'test-bucket' }), /PRIVATE_FLIGHT_TRACK_BUCKET_REFUSED/);
  const message = formatR2Error(new Error('test-secret-key test-access-key'), env);
  assert.ok(!message.includes(env.R2_SECRET_ACCESS_KEY)); assert.ok(!message.includes(env.R2_ACCESS_KEY_ID));
});

test('tampered local payload, missing tile, symlink and forged version fail before any remote operation', async t => {
  const temp = await mkdtemp('/tmp/bc-obstacle-r2-invalid-'); t.after(() => rm(temp, { recursive: true, force: true }));
  const original = plans.preuseville;
  for (const kind of ['corrupt', 'missing', 'symlink', 'manifest', 'gzip', 'coverage']) {
    const dir = join(temp, kind, original.version.slice(0, 16)); await cp(original.root, dir, { recursive: true });
    const path = join(dir, original.manifest.tiling.tiles[0].key);
    if (kind === 'corrupt') await writeFile(path, 'corrupt');
    if (kind === 'missing') await rm(path);
    if (kind === 'symlink') { await rm(path); const { symlink } = await import('node:fs/promises'); await symlink(join(original.root, original.manifest.tiling.tiles[0].key), path); }
    if (kind === 'manifest') { const m = JSON.parse(await readFile(join(dir, 'manifest.json'))); m.identity.policy.overviewZoom = 8; await writeFile(join(dir, 'manifest.json'), JSON.stringify(m)); }
    if (kind === 'gzip') {
      const m = JSON.parse(await readFile(join(dir, 'manifest.json'))), tile = m.tiling.tiles[0], key = tile.key + '.gz', bytes = gzipSync('{}\n');
      await writeFile(join(dir, key), bytes); const delta = bytes.length - m.artifacts[key].bytes;
      Object.assign(m.artifacts[key], { bytes: bytes.length, sha256: sha(bytes) });
      tile.gzipBytes = bytes.length; tile.gzipSha256 = sha(bytes); m.statistics.payloadBytes += delta; m.statistics.tileGzipBytes += delta;
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
    }
    if (kind === 'coverage') {
      const m = JSON.parse(await readFile(join(dir, 'manifest.json'))), c = JSON.parse(await readFile(join(dir, 'coverage.geojson')));
      c.features[1].properties.key = 'wrong-key'; const raw = Buffer.from(JSON.stringify(c)), gz = gzipSync(raw);
      for (const [key, bytes] of [['coverage.geojson', raw], ['coverage.geojson.gz', gz]]) {
        m.statistics.payloadBytes += bytes.length - m.artifacts[key].bytes;
        Object.assign(m.artifacts[key], { bytes: bytes.length, sha256: sha(bytes) }); await writeFile(join(dir, key), bytes);
      }
      m.coverage.sha256 = m.artifacts['coverage.geojson.gz'].decodedSha256 = sha(raw);
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
    }
    await assert.rejects(buildPlan(dir), /SHA256|ENOENT|UNSAFE|HASH_MISMATCH|GZIP_INTEGRITY|INVALID_TILE_COVERAGE/);
  }
});

test('complete publication verifies every payload publicly before immutable manifest, and activates last; runtime 2B reads it', async t => {
  const remote = await localRemote(t), p = protocolPlan(plans.preuseville);
  remote.hookS3((op, item) => {
    if (op === 'PutObjectCommand' && item.Key === keyFor(p, 'manifest.json')) {
      for (const payload of p.items.slice(0, -1)) for (const method of ['GET', 'HEAD']) {
        assert.ok(remote.requests.some(r => r.key === keyFor(p, payload.key) && r.method === 'OPTIONS' && r.requestedMethod === method));
      }
    }
  });
  const result = await publish(remote, p); assert.equal(result.activation, 'VERIFIED');
  const puts = remote.calls.filter(c => c.op === 'PutObjectCommand');
  assert.equal(puts.at(-2).key, keyFor(p, 'manifest.json')); assert.equal(puts.at(-1).key, pointerKey(p));
  assert.equal(remote.objects.get(pointerKey(p)).CacheControl, ACTIVE_CACHE);
  const before = puts.length; assert.equal((await publish(remote, p)).activation, 'UNCHANGED');
  assert.equal(remote.calls.filter(c => c.op === 'PutObjectCommand').length, before);
  const runtime = new AeronauticalObstacleTileRuntime({ baseUrl: `${remote.config.publicBase}/${PREFIX}/${p.zone}/${p.version}/`, manifestSha256: p.manifestSha256 });
  t.after(() => runtime.dispose());
  assert.equal((await runtime.readManifest()).version, p.version);
  for (const zoom of [9, 12]) {
    const v = runtime.createView(); const r = await v.update({ west: 1.49, east: 1.52, south: 49.87, north: 49.89 }, zoom);
    assert.ok(r.snapshot.features.length); assert.equal(r.snapshot.exhaustive, false); v.close();
  }
});

test('interruption before manifest preserves previous active version and resumes without duplicate writes', async t => {
  const remote = await localRemote(t), first = protocolPlan(plans.preuseville), next = protocolPlan(second);
  await publish(remote, first); const previous = Buffer.from(remote.objects.get(pointerKey(first)).bytes);
  let count = 0;
  remote.hookS3((op, p) => { if (op === 'PutObjectCommand' && p.Key.includes(next.version) && ++count === 3) throw fail(503, 'ServiceUnavailable'); });
  await assert.rejects(publish(remote, next), /PutObject|503/);
  assert.ok(!remote.objects.has(keyFor(next, 'manifest.json'))); assert.deepEqual(remote.objects.get(pointerKey(first)).bytes, previous);
  const alreadyWritten = new Set(remote.calls.filter(c => c.op === 'PutObjectCommand' && remote.objects.has(c.key)).map(c => c.key));
  remote.calls.length = 0; remote.hookS3(undefined);
  assert.equal((await publish(remote, next)).activation, 'VERIFIED');
  for (const call of remote.calls.filter(c => c.op === 'PutObjectCommand' && c.key !== pointerKey(first))) assert.ok(!alreadyWritten.has(call.key));
});

test('remote corruption/conflict and a visible manifest with missing payload are refused before any write', async t => {
  const remote = await localRemote(t), p = protocolPlan(plans.preuseville);
  await publish(remote, p); const first = p.items[0], key = keyFor(p, first.key);
  const saved = remote.objects.get(key); remote.objects.set(key, { ...saved, bytes: Buffer.alloc(saved.bytes.length) });
  remote.calls.length = 0;
  await assert.rejects(publish(remote, p), /REMOTE_VERSION_CONFLICT/);
  assert.ok(!remote.calls.some(c => c.op === 'PutObjectCommand'));
  remote.objects.delete(key); remote.calls.length = 0;
  await assert.rejects(publish(remote, p), /PUBLISHED_VERSION_INCOMPLETE/);
  assert.ok(!remote.calls.some(c => c.op === 'PutObjectCommand'));
});

test('public CORS, HTTP, content type, cache and decoded checksum failures never expose a manifest or active release', async t => {
  for (const problem of ['cors', 'http', 'type', 'cache', 'hash', 'encoding']) {
    const remote = await localRemote(t), p = protocolPlan(plans.preuseville);
    remote.hookHTTP((key, req, res) => {
      if (req.method !== 'GET') return false;
      if (problem === 'encoding' && !key.endsWith('.gz')) return false;
      res.setHeader('Access-Control-Allow-Origin', problem === 'cors' ? 'https://wrong.invalid' : req.headers.origin);
      res.setHeader('Content-Type', problem === 'type' ? 'text/plain' : 'application/geo+json');
      res.setHeader('Cache-Control', problem === 'cache' ? 'no-store' : p.items[0].cacheControl);
      res.writeHead(problem === 'http' ? 503 : 200).end(problem === 'hash' ? 'wrong' : p.items[0].body); return true;
    });
    await assert.rejects(publish(remote, p), /PUBLIC_/);
    assert.ok(!remote.objects.has(keyFor(p, 'manifest.json')), problem); assert.ok(!remote.objects.has(pointerKey(p)), problem);
  }
});

test('read-only check makes no writes, and incomplete rollback cannot modify active', async t => {
  const remote = await localRemote(t), p = protocolPlan(plans.preuseville);
  const check = await runRemote(p, remote.config, { client: remote.client });
  assert.equal(check.missing, p.items.length); assert.equal(check.writeAccessVerified, null);
  assert.ok(!remote.calls.some(c => c.op === 'PutObjectCommand'));
  await assert.rejects(runRemote(p, remote.config, { client: remote.client, mode: 'rollback', approval: approval(p), expectedActiveSha256: '0'.repeat(64) }), /ROLLBACK_TARGET/);
});

test('rollback changes only active.json, rechecks all old objects and retains both immutable versions', async t => {
  const remote = await localRemote(t), p = protocolPlan(plans.preuseville), next = protocolPlan(second);
  await publish(remote, p); await publish(remote, next); remote.calls.length = 0;
  const result = await runRemote(p, remote.config, { mode: 'rollback', client: remote.client, approval: approval(p), expectedActiveSha256: next.manifestSha256 });
  assert.equal(result.active.version, p.version); assert.equal(result.active.previous.version, next.version);
  assert.deepEqual(remote.calls.filter(c => c.op === 'PutObjectCommand').map(c => c.key), [pointerKey(p)]);
  assert.ok(remote.objects.has(keyFor(p, 'manifest.json'))); assert.ok(remote.objects.has(keyFor(next, 'manifest.json')));
});

test('concurrent activation is never overwritten; failure after active write explicitly reports a committed change', async t => {
  const remote = await localRemote(t), p = protocolPlan(plans.preuseville);
  remote.hookS3((op, item) => { if (op === 'PutObjectCommand' && item.Key === pointerKey(p)) throw fail(412, 'PreconditionFailed'); });
  await assert.rejects(publish(remote, p), /ACTIVE_CHANGED_CONCURRENTLY/); assert.ok(!remote.objects.has(pointerKey(p)));
  remote.hookS3(undefined);
  remote.hookHTTP((key, req, res) => { if (key !== pointerKey(p)) return false; res.writeHead(503).end(); return true; });
  await assert.rejects(publish(remote, p), /ACTIVE_WRITTEN_VERIFY_FAILED/); assert.ok(remote.objects.has(pointerKey(p)));
});

test('a lost activation acknowledgement is reconciled only when the committed pointer matches exactly', async t => {
  const remote = await localRemote(t), plan = protocolPlan(plans.preuseville);
  remote.hookS3((op, p) => {
    if (op !== 'PutObjectCommand' || p.Key !== pointerKey(plan)) return;
    const bytes = Buffer.from(p.Body);
    remote.objects.set(p.Key, { bytes, ContentType: p.ContentType, ContentEncoding: p.ContentEncoding,
      CacheControl: p.CacheControl, Metadata: p.Metadata, ETag: `"${sha(bytes)}"` });
    throw fail(412, 'PreconditionFailed');
  });
  assert.equal((await publish(remote, plan)).activation, 'VERIFIED');
});

test('SDK failures redact credentials supplied directly in config, even when absent from the shell environment', async () => {
  const secret = 'unit-test-only-secret', access = 'unit-test-only-access';
  const config = { prefix: PREFIX, bucket: 'test', credentials: { accessKeyId: access, secretAccessKey: secret } };
  const client = { async send() { throw new Error(`SDK echoed ${secret} ${access}`); } };
  await assert.rejects(runRemote(plans.preuseville, config, { client }), error => !error.message.includes(secret)
    && !error.message.includes(access) && error.message.includes('ListObjectsV2'));
});
