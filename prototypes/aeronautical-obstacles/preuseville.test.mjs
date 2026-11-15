import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreuseville } from './preuseville.mjs';
import { sha256 } from './normalize.ts';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bc-obstacles-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const study = join(root, 'study'); await mkdir(study);
  // Deliberately synthetic source bytes: test preflight/packaging, not real XLSX/PBF extraction.
  const files = {
    'sia-20261029.xlsx': 'synthetic-xlsx', 'georisques-turbine.csv': 'synthetic-csv',
    'haute-normandie.osm.pbf': 'synthetic-pbf-normandie', 'picardie.osm.pbf': 'synthetic-pbf-picardie',
    'fetch.py': '# fixture', 'extract_osm.py': '# fixture', 'normalize.py': '# fixture',
    'sia-local-raw.json': JSON.stringify([{ IDENTIFICATEUR: 'synthetic-1', TYPE: 'Pylône',
      'LONGITUDE DECIMALE': '1.5047', 'LATITUDE DECIMALE': '49.8804', 'SYSTEME DE REFERENCE HORIZONTALE': 'WGS84' }]),
    'georisques-local-raw.json': '[]',
  };
  files['osm-local-raw.json'] = JSON.stringify({ sources: ['haute-normandie', 'picardie'].map(region => ({
    region, sha256: sha256(files[`${region}.osm.pbf`]), snapshot_utc: null,
  })), elements: [{ id: 'node/1', longitude: 1.5047, latitude: 49.8804, position_method: 'node',
    extracts: ['haute-normandie'], tags: { power: 'tower' } }] });
  const inventory = { raw_files: Object.entries(files).map(([file, bytes]) => ({ file, sha256: sha256(bytes) })) };
  files['sources.json'] = JSON.stringify(inventory);
  for (const file of ['sia-20261029.xlsx', 'georisques-turbine.csv']) {
    files[`${file}.metadata.json`] = JSON.stringify({ status: 200, url: 'https://example.invalid/synthetic', sha256: sha256(files[file]) });
  }
  await Promise.all(Object.entries(files).map(([file, bytes]) => writeFile(join(study, file), bytes)));
  return { root, study };
}

test('local packaging preserves records, verified hashes, missing dates and exclusions; refuses overwrite', async t => {
  const { root, study } = await fixture(t), output = join(root, 'output');
  const result = await buildPreuseville(study, output);
  assert.equal(result.records, 1); assert.deepEqual(result.excluded, { ordinary_electric_support: 1 });
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sources[0].retrievedAtUtc, null);
  for (const [file, entry] of Object.entries(manifest.artifacts)) {
    assert.equal(sha256(await readFile(join(output, file))), entry.sha256);
  }
  const records = JSON.parse(await readFile(join(output, 'records.json'), 'utf8'));
  assert.equal(records[0].measurements.topAmsl.valueM, null);
  assert.equal(records[0].original.IDENTIFICATEUR, 'synthetic-1');
  const second = join(root, 'reproduction');
  await buildPreuseville(study, second);
  const repeated = JSON.parse(await readFile(join(second, 'manifest.json'), 'utf8'));
  assert.equal(repeated.version, manifest.version);
  assert.deepEqual(repeated.artifacts, manifest.artifacts);
  assert.deepEqual(repeated.identity, manifest.identity);
  await assert.rejects(buildPreuseville(study, output), { code: 'EEXIST' });
});

test('missing or altered source aborts explicitly without creating an output', async t => {
  const { root, study } = await fixture(t), output = join(root, 'output');
  await writeFile(join(study, 'georisques-local-raw.json'), '[{}]');
  await assert.rejects(buildPreuseville(study, output), /SOURCE_SHA256_MISMATCH: georisques-local-raw.json/);
  await assert.rejects(access(output), { code: 'ENOENT' });
  await rm(join(study, 'georisques-local-raw.json'));
  await assert.rejects(buildPreuseville(study, output), { code: 'ENOENT' });
});

test('output inside repository or through a symlink to it is rejected before creating directories', async t => {
  const { root, study } = await fixture(t);
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const direct = resolve(repository, 'prototypes/aeronautical-obstacles/forbidden-output-test');
  await assert.rejects(buildPreuseville(study, direct), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  await assert.rejects(access(direct), { code: 'ENOENT' });
  const link = join(root, 'repository'); await symlink(repository, link);
  await assert.rejects(buildPreuseville(study, join(link, 'forbidden-output-test')), /OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  await assert.rejects(access(resolve(repository, 'forbidden-output-test')), { code: 'ENOENT' });
});
