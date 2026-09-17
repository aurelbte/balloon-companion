import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { memoryFactory, memoryStorage } from './guestImportTestHarness.mjs';
import { acquireGuestImportClaim, GUEST_IMPORT_CLAIM_DB, GUEST_IMPORT_CLAIM_STORE } from './guestImportClaim.ts';
import { inspectGuestSources, makeGuestManifest, fingerprint, FLIGHT_SESSION_KEY } from './guestImportManifest.ts';
import { migrateGuestAndLegacyToUser, GUEST_TO_USER_MIGRATION_KEY } from './guestToUserMigration.ts';
import { migrateApprovedLegacyData } from './localDataMigration.ts';
import { getRuntimeDataScope, getRuntimeDataScopeGeneration, guestBusinessStorageKey, scopedBusinessStorageKey, scopedIndexedDbName, setRuntimeAuthSnapshot } from './dataScopeRuntime.ts';
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from '../recordedFlightStorage.ts';
import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE, BALLOON_DOCUMENT_FILES_STORE } from '../balloonDocumentStorage.ts';
import { MemorySyncOutboxStorage } from '../syncOutbox.ts';
import { recoverLocalStorageSyncIntents, withSyncIntents } from '../durableSyncIntent.ts';
const profile = 'balloon-companion-pilot-profile';
const signed = id => setRuntimeAuthSnapshot(id ? { state: 'SIGNED_IN', user: { id } } : { state: 'SIGNED_OUT', user: null });
const accountKey = (id, key = profile) => scopedBusinessStorageKey(`USER:${id}`, key);
function setup() { signed('A'); const storage = memoryStorage({ [guestBusinessStorageKey(profile)]: JSON.stringify({ firstName: 'Guest' }) }), factory = memoryFactory(); return { storage, factory }; }
function queue(user = 'A', hook = async () => {}) { const values = []; return { values, getScope: () => `USER:${user}`, async enqueue(value) { await hook(value); values.push(value); return { ...value, mutationId: `m${values.length}` }; } }; }
const run = (env, user = 'A', outbox = queue(user)) => migrateGuestAndLegacyToUser({ ...env, userId: user, deviceId: 'D', outbox });
const claims = env => env.factory.peek(GUEST_IMPORT_CLAIM_DB)?.rows(GUEST_IMPORT_CLAIM_STORE) ?? [];

test('guest -> A claim and import; logout -> B refused; A -> A no duplicates', async () => {
 const env = setup(), outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'COMPLETE'); assert.equal(claims(env)[0].userId, 'A');
 signed(null); signed('B'); const b = queue('B'); assert.equal((await run(env, 'B', b)).state, 'CLAIMED_OTHER'); assert.equal(b.values.length, 0); assert.equal(env.storage.getItem(accountKey('B')), null);
 signed('A'); assert.equal((await run(env, 'A', outbox)).imported, 0); assert.equal(outbox.values.length, 1); assert.ok(env.storage.getItem(guestBusinessStorageKey(profile)));
});
test('atomic concurrent acquisitions have exactly one owner', async () => {
 const env = setup(), factory = env.factory, manifest = await makeGuestManifest((await inspectGuestSources(env.storage, factory, () => {})).entries);
 const results = await Promise.all(['A', 'B'].map(user => acquireGuestImportClaim(factory, manifest, user, 'D', () => {})));
 assert.deepEqual(results.map(result => result.state).sort(), ['CLAIMED_OTHER', 'OWNED']); assert.equal(factory.db(GUEST_IMPORT_CLAIM_DB).rows(GUEST_IMPORT_CLAIM_STORE).length, 1);
});
test('crash after claim before copy: fresh service resumes A, B refused', async () => {
 const env = setup(); await assert.rejects(run(env, 'A', queue('A', () => { throw Error('crash'); }))); assert.equal(claims(env)[0].userId, 'A'); assert.equal(env.storage.getItem(accountKey('A')), null);
 signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER'); signed('A'); assert.equal((await run(env)).state, 'COMPLETE');
});
test('crash after copy before checkpoint: same owner resumes without duplicate', async () => {
 const env = setup(), set = env.storage.setItem; let first = true;
 env.storage.setItem = (k, v) => { if (first && k === GUEST_TO_USER_MIGRATION_KEY) { first = false; throw Error('crash'); } set(k, v); };
 await assert.rejects(run(env)); assert.ok(env.storage.getItem(accountKey('A'))); signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER'); signed('A');
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'COMPLETE'); assert.equal(outbox.values.length, 0);
});
test('partial import and temporary enqueue failure retain claim/checkpoints and retry', async () => {
 const env = setup(), weather = 'balloon-companion-weather-preferences-v1'; env.storage.setItem(guestBusinessStorageKey(weather), JSON.stringify({ weatherModel: 'gfs' }));
 let calls = 0; await assert.rejects(run(env, 'A', queue('A', () => { if (++calls === 2) throw Error('temporary'); })));
 assert.equal(claims(env)[0].userId, 'A'); const retry = queue(); await run(env, 'A', retry); assert.deepEqual(retry.values.map(v => v.entityType), ['weather-preferences']);
});
for (const transition of ['logout', 'A-B', 'A-B-A', 'generation']) test(`${transition} during enqueue stops before business copy/checkpoint`, async () => {
 const env = setup(), before = getRuntimeDataScopeGeneration(); const outbox = queue('A', () => { signed(null); if (transition !== 'logout') signed('B'); if (transition === 'A-B-A' || transition === 'generation') signed('A'); });
 assert.equal((await run(env, 'A', outbox)).state, 'OBSOLETE'); assert.ok(getRuntimeDataScopeGeneration() > before); assert.equal(env.storage.getItem(accountKey('A')), null); assert.equal(env.storage.getItem(accountKey('B')), null); assert.equal(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY), null); assert.equal(claims(env)[0].userId, 'A');
});
test('same user auth refresh does not invalidate import', async () => { const env = setup(); assert.equal((await run(env, 'A', queue('A', () => signed('A')))).state, 'COMPLETE'); });
test('unavailable, unreadable claim, failed discovery and invalid history block import', async () => {
 for (const kind of ['missing', 'invalid', 'discovery', 'history']) {
  const env = setup();
  if (kind === 'missing') env.factory = undefined;
  if (kind === 'invalid') env.factory.db(GUEST_IMPORT_CLAIM_DB).seed(GUEST_IMPORT_CLAIM_STORE, { id: 'broken', userId: 'A' });
  if (kind === 'discovery') env.factory.databases = undefined;
  if (kind === 'history') env.storage.setItem(GUEST_TO_USER_MIGRATION_KEY, '{invalid');
  const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(outbox.values.length, 0); assert.equal(env.storage.getItem(accountKey('A')), null);
 }
});
test('empty lot does not acquire claim or write migration marker', async () => {
 signed('A'); const env = { storage: memoryStorage(), factory: memoryFactory() }; assert.equal((await run(env)).state, 'COMPLETE'); assert.deepEqual(await env.factory.databases(), []); assert.equal(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY), null);
});
for (const owners of [['A'], ['A', 'B']]) test(`historical ${owners.join('+')} markers require review; no invented owner`, async () => {
 const env = setup(); env.storage.setItem(GUEST_TO_USER_MIGRATION_KEY, JSON.stringify(Object.fromEntries(owners.map(userId => [`${userId}:D`, { userId, deviceId: 'D', completedDomains: [profile], collisions: [], completedAt: 'old' }]))));
 assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0); assert.equal(env.storage.getItem(accountKey('A')), null);
});
test('copy without historical checkpoint is ambiguous', async () => { const env = setup(); env.storage.setItem(accountKey('B'), env.storage.getItem(guestBusinessStorageKey(profile))); assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0); });
test('recorded flights preserve GPS points; restart resumes and B gets no flights', async () => {
 const env = setup(); env.storage.removeItem(guestBusinessStorageKey(profile)); const source = env.factory.db(scopedIndexedDbName('GUEST', RECORDED_FLIGHT_DB_NAME));
 const flight = { id: 'f1', points: [{ latitude: 48, longitude: 2, timestamp: 1 }, { latitude: 49, longitude: 3, timestamp: 2 }] }; source.seed(RECORDED_FLIGHTS_STORE, flight);
 await run(env); assert.deepEqual(env.factory.db(scopedIndexedDbName('USER:A', RECORDED_FLIGHT_DB_NAME)).rows(RECORDED_FLIGHTS_STORE), [flight]);
 signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER'); assert.ok(!(await env.factory.databases()).some(db => db.name === scopedIndexedDbName('USER:B', RECORDED_FLIGHT_DB_NAME)));
});
test('documents preserve metadata and binary file; B receives neither', async () => {
 const env = setup(); env.storage.removeItem(guestBusinessStorageKey(profile)); const source = env.factory.db(scopedIndexedDbName('GUEST', BALLOON_DOCUMENT_DB_NAME));
 const document = { id: 'd1', balloonId: 'b1', title: 'PDF' }, file = { documentId: 'd1', blob: new Blob(['binary-content']) }; source.seed(BALLOON_DOCUMENTS_STORE, document); source.seed(BALLOON_DOCUMENT_FILES_STORE, file, 'documentId');
 await run(env); const dest = env.factory.db(scopedIndexedDbName('USER:A', BALLOON_DOCUMENT_DB_NAME)); assert.deepEqual(dest.rows(BALLOON_DOCUMENTS_STORE), [document]); assert.equal(await dest.rows(BALLOON_DOCUMENT_FILES_STORE)[0].blob.text(), 'binary-content');
 signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER');
});
test('legacy IndexedDB copied before marker requires review', async () => {
 const env = setup(); const flight = { id: 'f1', points: [{ latitude: 48, longitude: 2, timestamp: 1 }] }; env.factory.db(RECORDED_FLIGHT_DB_NAME).seed(RECORDED_FLIGHTS_STORE, flight); env.factory.db(scopedIndexedDbName('USER:B', RECORDED_FLIGHT_DB_NAME)).seed(RECORDED_FLIGHTS_STORE, flight);
 assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0);
});
test('outbox with wrong scope cannot receive imported mutations', async () => { const env = setup(), b = queue('B'); assert.equal((await run(env, 'A', b)).state, 'IMPORT_BLOCKED'); assert.equal(b.values.length, 0); });
test('legacy importer is closed before any repository read/write', async () => {
 let accessed = false; const repository = new Proxy({}, { get() { accessed = true; throw Error('unsafe'); } });
 const result = await migrateApprovedLegacyData({ userId: 'A', deviceId: 'D', repository }); assert.equal(result.id, 'B6_CLAIM_REQUIRED'); assert.equal(accessed, false);
});
test('B5 successor and C2 A intent remain isolated after B refusal', async () => {
 const env = setup(), outbox = new MemorySyncOutboxStorage(); const first = await outbox.enqueue({ entityType: 'pilot-profile', entityId: 'singleton', operation: 'UPSERT' }); await outbox.markAttempt(first.mutationId);
 await run(env, 'A', outbox); assert.equal((await outbox.list()).length, 2);
 env.storage.setItem(accountKey('A'), JSON.stringify(withSyncIntents({ firstName: 'A' }, [{ entityType: 'pilot-profile', entityId: 'singleton', operation: 'UPSERT' }], {}, 'USER:A')));
 signed('B'); const b = new MemorySyncOutboxStorage(); assert.equal((await run(env, 'B', b)).state, 'CLAIMED_OTHER'); await assert.rejects(recoverLocalStorageSyncIntents(env.storage, 'USER:A', b)); assert.equal((await b.list()).length, 0); assert.equal(getRuntimeDataScope(), 'USER:B');
});
test('claim refusal completes Auth gate for B; blocked/review is explicit', () => {
 const auth = readFileSync(new URL('../../contexts/AuthContext.tsx', import.meta.url), 'utf8');
 assert.match(auth, /report.state === "CLAIMED_OTHER"[\s\S]*setLocalDataMigrationState\("MIGRATION_IMPORT_SKIPPED"\)/); assert.match(auth, /controller.abort\(\)/);
 assert.match(auth, /report.state === "REVIEW_REQUIRED" \|\| report.state === "DEFERRED"/);
});

test('unscoped legacy source uses the same exclusive claim', async () => {
 const env = setup(); env.storage.removeItem(guestBusinessStorageKey(profile)); env.storage.setItem(profile, JSON.stringify({ firstName: 'Legacy' }));
 assert.equal((await run(env)).state, 'COMPLETE'); signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER'); assert.equal(env.storage.getItem(profile), JSON.stringify({ firstName: 'Legacy' }));
});
test('historical legacy importer marker also prevents automatic ownership', async () => {
 const env = setup(); env.storage.setItem('balloon-companion-auth-legacy-migration-completions-v1', JSON.stringify({ 'B:D': { userId: 'B' } }));
 assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0);
});
test('AbortSignal stops import after durable claim without releasing it', async () => {
 const env = setup(), controller = new AbortController();
 assert.equal((await run({ ...env, signal: controller.signal }, 'A', queue('A', () => controller.abort()))).state, 'OBSOLETE'); assert.equal(claims(env)[0].userId, 'A'); assert.equal(env.storage.getItem(accountKey('A')), null);
 assert.equal((await run(env)).state, 'COMPLETE');
});
for (const [base, store, entityType] of [[RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE, 'flight'], [BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE, 'balloon-document']]) test(`${entityType} async identity change prevents IDB copy and B enqueue`, async () => {
 const env = setup(); env.storage.removeItem(guestBusinessStorageKey(profile)); const source = env.factory.db(scopedIndexedDbName('GUEST', base)); source.seed(store, { id: 'entity1', points: [{ latitude: 48, longitude: 2, timestamp: 1 }], title: 'A' }); if (base === BALLOON_DOCUMENT_DB_NAME) source.createObjectStore(BALLOON_DOCUMENT_FILES_STORE, { keyPath: 'documentId' });
 assert.equal((await run(env, 'A', queue('A', () => signed('B')))).state, 'OBSOLETE'); assert.deepEqual(env.factory.db(scopedIndexedDbName('USER:A', base)).rows(store), []);
 const b = queue('B'); assert.equal((await run(env, 'B', b)).state, 'CLAIMED_OTHER'); assert.equal(b.values.length, 0); assert.equal(claims(env)[0].userId, 'A');
});

test('G1 complete A -> new G2 -> B: separate immutable manifests, G1 excluded', async () => {
 const env = setup(); await run(env); const g1 = claims(env)[0];
 const balloons = 'balloon-companion-balloons'; env.storage.setItem(guestBusinessStorageKey(balloons), JSON.stringify({ balloons: [{ id: 'G2' }] }));
 signed('B'); const b = queue('B'), result = await run(env, 'B', b); assert.equal(result.state, 'COMPLETE');
 assert.notEqual(result.manifestId, g1.id); assert.deepEqual(b.values.map(v => v.entityId), ['G2']); assert.equal(env.storage.getItem(accountKey('B')), null);
 assert.equal(claims(env).find(c => c.id === g1.id).userId, 'A'); const g2 = claims(env).find(c => c.userId === 'B'); assert.equal(g2.manifest.entries.length, 1); assert.equal(g2.manifest.entries[0].value.id, 'G2');
});
test('G1 partial A -> G2 -> A retry uses only exact G1 snapshot/checkpoints', async () => {
 const env = setup(), weather = 'balloon-companion-weather-preferences-v1', balloons = 'balloon-companion-balloons'; env.storage.setItem(guestBusinessStorageKey(weather), JSON.stringify({ weatherModel: 'gfs' }));
 let calls = 0; await assert.rejects(run(env, 'A', queue('A', () => { if (++calls === 2) throw Error('crash'); }))); const id = claims(env)[0].id;
 env.storage.setItem(guestBusinessStorageKey(balloons), JSON.stringify({ balloons: [{ id: 'G2' }] })); env.storage.setItem(guestBusinessStorageKey(weather), JSON.stringify({ weatherModel: 'NEW-G2' }));
 const a = queue(); assert.equal((await run(env, 'A', a)).manifestId, id); assert.deepEqual(a.values.map(v => v.entityType), ['weather-preferences']); assert.equal(env.storage.getItem(accountKey('A', balloons)), null); assert.equal(JSON.parse(env.storage.getItem(accountKey('A', weather))).weatherModel, 'gfs');
 const stored = JSON.parse(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY)); assert.ok(stored[`A:D:${id}`].completedAt);
 signed('B'); const b = queue('B'); await run(env, 'B', b); assert.deepEqual(b.values.map(v => v.entityType).sort(), ['balloon', 'weather-preferences']);
});
test('different disjoint manifests can be claimed concurrently', async () => {
 const env = setup(), first = await makeGuestManifest((await inspectGuestSources(env.storage, env.factory, () => {})).entries);
 env.storage.removeItem(guestBusinessStorageKey(profile)); env.storage.setItem(guestBusinessStorageKey('balloon-companion-balloons'), JSON.stringify({ balloons: [{ id: 'G2' }] }));
 const second = await makeGuestManifest((await inspectGuestSources(env.storage, env.factory, () => {})).entries);
 const results = await Promise.all([acquireGuestImportClaim(env.factory, first, 'A', 'D', () => {}), acquireGuestImportClaim(env.factory, second, 'B', 'D', () => {})]); assert.deepEqual(results.map(r => r.state), ['OWNED', 'OWNED']); assert.equal(claims(env).length, 2);
});
test('overlapping different manifests cannot assign one entity to two owners', async () => {
 const env = setup(), inspection = await inspectGuestSources(env.storage, env.factory, () => {}), first = await makeGuestManifest(inspection.entries);
 env.storage.setItem(guestBusinessStorageKey('balloon-companion-balloons'), JSON.stringify({ balloons: [{ id: 'G2' }] })); const second = await makeGuestManifest((await inspectGuestSources(env.storage, env.factory, () => {})).entries);
 assert.equal((await acquireGuestImportClaim(env.factory, first, 'A', 'D', () => {})).state, 'OWNED'); assert.equal((await acquireGuestImportClaim(env.factory, second, 'B', 'D', () => {})).state, 'STALE_MANIFEST');
});
test('change during manifest construction is rejected before claim/copy', async () => {
 const env = setup(), get = env.storage.getItem; let reads = 0;
 env.storage.getItem = key => { if (key === guestBusinessStorageKey(profile) && ++reads === 2) env.storage.setItem(key, JSON.stringify({ firstName: 'G2' })); return get(key); };
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'SOURCE_CHANGED'); assert.equal(outbox.values.length, 0); assert.equal(claims(env).length, 0);
});
test('change during acquisition: no copy; durable old snapshot does not absorb new version', async () => {
 const env = setup(), open = env.factory.open; let changed = false;
 env.factory.open = function(name) { if (name === GUEST_IMPORT_CLAIM_DB && !changed) { changed = true; env.storage.setItem(guestBusinessStorageKey(profile), JSON.stringify({ firstName: 'G2' })); } return open.call(this, name); };
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'SOURCE_CHANGED'); assert.equal(outbox.values.length, 0); assert.equal(claims(env)[0].manifest.entries[0].value.firstName, 'Guest');
 await run(env); assert.equal(JSON.parse(env.storage.getItem(accountKey('A'))).firstName, 'Guest');
});
test('schema-invalid JSON is INVALID/blocked, never EMPTY/COMPLETE', async () => {
 const env = setup(); env.storage.removeItem(guestBusinessStorageKey(profile)); env.storage.setItem(guestBusinessStorageKey('balloon-companion-balloons'), '{"balloons":"unreadable-list"}');
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(outbox.values.length, 0); assert.equal(claims(env).length, 0);
});
test('manifest-linked DEFERRED prevents claim/import; unrelated decision not reused', async () => {
 const { saveLocalDataMigrationDecision } = await import('./localDataMigrationDecision.ts'); const env = setup(), manifest = await makeGuestManifest((await inspectGuestSources(env.storage, env.factory, () => {})).entries);
 saveLocalDataMigrationDecision(env.storage, { userId: 'A', deviceId: 'D', manifestId: manifest.id, decision: 'MIGRATION_DEFERRED' });
 assert.equal((await run(env)).state, 'DEFERRED'); assert.equal(claims(env).length, 0); assert.equal(env.storage.getItem(accountKey('A')), null); assert.equal(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY), null);
 env.storage.removeItem(guestBusinessStorageKey(profile)); env.storage.setItem(guestBusinessStorageKey('balloon-companion-balloons'), JSON.stringify({ balloons: [{ id: 'G2' }] })); assert.equal((await run(env)).state, 'COMPLETE');
});
test('unbound historical DEFERRED is review-required, preserved after new service/reload', async () => {
 const { saveLocalDataMigrationDecision } = await import('./localDataMigrationDecision.ts'); const env = setup(); saveLocalDataMigrationDecision(env.storage, { userId: 'A', deviceId: 'D', decision: 'MIGRATION_DEFERRED' });
 for (let i = 0; i < 2; i++) { assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0); }
});
test('canonical digest does not depend on object property insertion order', async () => {
 const { fingerprint } = await import('./guestImportManifest.ts'); assert.equal(await fingerprint({ a: 1, b: 2 }), await fingerprint({ b: 2, a: 1 }));
});
test('partial mixed localStorage/IDB lot freezes flights, points, files and excludes future entities', async () => {
 const env = setup(), flights = env.factory.db(scopedIndexedDbName('GUEST', RECORDED_FLIGHT_DB_NAME)), docs = env.factory.db(scopedIndexedDbName('GUEST', BALLOON_DOCUMENT_DB_NAME));
 flights.seed(RECORDED_FLIGHTS_STORE, { id: 'f1', points: [{ latitude: 48, longitude: 2, timestamp: 1 }] }); docs.seed(BALLOON_DOCUMENTS_STORE, { id: 'd1', title: 'old' }); docs.seed(BALLOON_DOCUMENT_FILES_STORE, { documentId: 'd1', file: new Blob(['G1']) }, 'documentId');
 await assert.rejects(run(env, 'A', queue('A', v => { if (v.entityType === 'flight') throw Error('crash'); })));
 flights.seed(RECORDED_FLIGHTS_STORE, { id: 'f1', points: [{ latitude: 49, longitude: 4, timestamp: 2 }] }); flights.seed(RECORDED_FLIGHTS_STORE, { id: 'f2', points: [{ latitude: 49, longitude: 3, timestamp: 3 }] });
 docs.seed(BALLOON_DOCUMENTS_STORE, { id: 'd2', title: 'G2' }); docs.seed(BALLOON_DOCUMENT_FILES_STORE, { documentId: 'd1', file: new Blob(['new-version-G2']) }, 'documentId'); docs.seed(BALLOON_DOCUMENT_FILES_STORE, { documentId: 'd2', file: new Blob(['G2']) }, 'documentId');
 await run(env); const aFlight = env.factory.db(scopedIndexedDbName('USER:A', RECORDED_FLIGHT_DB_NAME)).rows(RECORDED_FLIGHTS_STORE); assert.deepEqual(aFlight.map(f => f.id), ['f1']); assert.equal(aFlight[0].points[0].latitude, 48);
 const aDocs = env.factory.db(scopedIndexedDbName('USER:A', BALLOON_DOCUMENT_DB_NAME)); assert.deepEqual(aDocs.rows(BALLOON_DOCUMENTS_STORE).map(d => d.id), ['d1']); assert.equal(await aDocs.rows(BALLOON_DOCUMENT_FILES_STORE)[0].file.text(), 'G1');
 signed('B'); const b = queue('B'); await run(env, 'B', b); assert.deepEqual(b.values.map(v => v.entityId).sort(), ['d2', 'f2']); assert.equal(await env.factory.db(scopedIndexedDbName('USER:B', BALLOON_DOCUMENT_DB_NAME)).rows(BALLOON_DOCUMENT_FILES_STORE)[0].file.text(), 'G2');
});

test('real nested unit preferences and empty default qualifications are handled correctly', async () => {
 const { DEFAULT_UNIT_PREFERENCES } = await import('../unitPreferences.ts'); const { createEmptyPilotQualificationsState } = await import('../pilotQualificationsStorage.ts');
 const env = setup(); env.storage.setItem(guestBusinessStorageKey('balloon-companion-unit-preferences-v1'), JSON.stringify(DEFAULT_UNIT_PREFERENCES)); env.storage.setItem(guestBusinessStorageKey('balloon-companion-pilot-qualifications-v1'), JSON.stringify(createEmptyPilotQualificationsState()));
 assert.equal((await run(env)).state, 'COMPLETE'); assert.deepEqual(JSON.parse(env.storage.getItem(accountKey('A', 'balloon-companion-unit-preferences-v1'))), DEFAULT_UNIT_PREFERENCES);
 assert.equal(claims(env)[0].manifest.entries.some(e => e.key === 'balloon-companion-pilot-qualifications-v1'), false);
});
test('source intents/tombstones of unknown ownership are never transported', async () => {
 const env = setup(); env.storage.setItem(guestBusinessStorageKey(profile), JSON.stringify({ firstName: 'A', __balloonPendingSync: [{ mutationId: 'A-intent', entityType: 'pilot-profile', entityId: 'singleton', operation: 'UPSERT' }] }));
 const b = queue('B'); signed('B'); assert.equal((await run(env, 'B', b)).state, 'REVIEW_REQUIRED'); assert.equal(b.values.length, 0); assert.equal(claims(env).length, 0);
});
test('manifest reader/canonical construction does not modify any source/business storage', async () => {
 const env = setup(), before = env.storage.snapshot(); const inspection = await inspectGuestSources(env.storage, env.factory, () => {}); await makeGuestManifest(inspection.entries);
 assert.deepEqual(env.storage.snapshot(), before); assert.deepEqual(await env.factory.databases(), []);
});
test('invalid manifest snapshot rejects resumption; no further enqueue', async () => {
 const env = setup(); await assert.rejects(run(env, 'A', queue('A', () => { throw Error('crash'); })));
 const row = structuredClone(claims(env)[0]); row.manifest.entries[0].value.firstName = 'tampered'; env.factory.db(GUEST_IMPORT_CLAIM_DB).seed(GUEST_IMPORT_CLAIM_STORE, row);
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(outbox.values.length, 0);
});
test('claim transaction abort leaves no owner and no business enqueue', async () => {
 const env = setup(), open = env.factory.open;
 env.factory.open = function(name) { const r = open.call(this, name); if (name === GUEST_IMPORT_CLAIM_DB) queueMicrotask(() => {
  const db = this.peek(name), original = db.transaction; db.transaction = function(names, mode, options) { const tx = original.call(this, names, mode, options); if (mode === 'readwrite') queueMicrotask(() => tx.abort()); return tx; };
 }); return r; };
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(outbox.values.length, 0); assert.equal(claims(env).length, 0);
});
test('blocked claim database fails safe with no permissive fallback', async () => {
 const env = setup(), open = env.factory.open;
 env.factory.open = function(name) { if (name === GUEST_IMPORT_CLAIM_DB) { const r = {}; queueMicrotask(() => r.onblocked?.()); return r; } return open.call(this, name); };
 const outbox = queue(); assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(outbox.values.length, 0); assert.equal(env.storage.getItem(accountKey('A')), null);
});
test('review remains explicit and stable after reconstructed service/reconnection', async () => {
 const env = setup(); env.storage.setItem(GUEST_TO_USER_MIGRATION_KEY, JSON.stringify({ 'A:D': { userId: 'A', deviceId: 'D', completedDomains: [profile], collisions: [], completedAt: 'old' } }));
 for (let i = 0; i < 2; i++) { signed(null); signed('B'); const b = queue('B'); assert.equal((await run(env, 'B', b)).state, 'REVIEW_REQUIRED'); assert.equal(b.values.length, 0); }
 assert.equal(claims(env).length, 0);
});

test('File snapshots validate and replay after claim/restart', async () => {
 const { File } = await import('node:buffer'); const env = setup(), docs = env.factory.db(scopedIndexedDbName('GUEST', BALLOON_DOCUMENT_DB_NAME)); docs.seed(BALLOON_DOCUMENTS_STORE, { id: 'd1', title: 'PDF', originalFileName: 'pilot.pdf' }); docs.seed(BALLOON_DOCUMENT_FILES_STORE, { documentId: 'd1', file: new File(['PDF'], 'pilot.pdf', { type: 'application/pdf' }) }, 'documentId');
 await assert.rejects(run(env, 'A', queue('A', () => { throw Error('crash'); }))); assert.equal((await run(env)).state, 'COMPLETE'); assert.equal(await env.factory.db(scopedIndexedDbName('USER:A', BALLOON_DOCUMENT_DB_NAME)).rows(BALLOON_DOCUMENT_FILES_STORE)[0].file.text(), 'PDF');
});
test('actual runtime gate enables account bootstrap after REVIEW/DEFER without importer COMPLETE', () => {
 const source = readFileSync(new URL('../../components/cloud/CloudSyncRuntime.tsx', import.meta.url), 'utf8');
 const start = source.indexOf('    if (auth.state !== "SIGNED_IN" || !auth.user)'); const end = source.indexOf('    const syncTargetedMutationById', start); assert.ok(start >= 0 && end > start);
 const gate = new Function('auth', 'automaticCloudSyncController', 'releaseBeforeScope', 'controlled', ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
 for (const importState of ['REVIEW_REQUIRED', 'DEFERRED']) {
  const calls = []; gate({ state: 'SIGNED_IN', user: { id: 'B' }, localDataMigrationState: 'MIGRATION_IMPORT_SKIPPED', localDataImportState: importState, localDataMigrationCollisions: [] }, { setUser: id => calls.push(id) }, () => {}, false); assert.deepEqual(calls, ['B']);
 }
});

test('old unmarked singleton copy subsequently edited stays review-required', async () => {
 const env = setup(); env.storage.setItem(accountKey('B'), JSON.stringify({ firstName: 'Edited after old copy' })); assert.equal((await run(env)).state, 'REVIEW_REQUIRED'); assert.equal(claims(env).length, 0);
});
test('new singleton fingerprint stays independent of a known A manifest and edited A account data', async () => {
 const env = setup(); await run(env); env.storage.setItem(accountKey('A'), JSON.stringify({ firstName: 'A scoped edit' })); env.storage.setItem(guestBusinessStorageKey(profile), JSON.stringify({ firstName: 'G2 new guest' }));
 signed('B'); assert.equal((await run(env, 'B')).state, 'COMPLETE'); assert.equal(JSON.parse(env.storage.getItem(accountKey('B'))).firstName, 'G2 new guest'); assert.deepEqual(claims(env).map(c => c.userId).sort(), ['A', 'B']);
});

test('document copy transaction crash rolls back metadata/file together; A retry idempotent, B excluded', async () => {
 const env = setup(), source = env.factory.db(scopedIndexedDbName('GUEST', BALLOON_DOCUMENT_DB_NAME)); source.seed(BALLOON_DOCUMENTS_STORE, { id: 'd1', title: 'G1' }); source.seed(BALLOON_DOCUMENT_FILES_STORE, { documentId: 'd1', file: new Blob(['G1']) }, 'documentId');
 const open = env.factory.open; let abort = true;
 env.factory.open = function(name) { const r = open.call(this, name); if (name === scopedIndexedDbName('USER:A', BALLOON_DOCUMENT_DB_NAME)) queueMicrotask(() => { const db = this.peek(name), original = db.transaction; db.transaction = function(names, mode, options) { const tx = original.call(this, names, mode, options); if (mode === 'readwrite' && abort) { abort = false; queueMicrotask(() => tx.abort()); } return tx; }; }); return r; };
 const outbox = new MemorySyncOutboxStorage(); await assert.rejects(run(env, 'A', outbox)); const dest = env.factory.peek(scopedIndexedDbName('USER:A', BALLOON_DOCUMENT_DB_NAME)); assert.deepEqual(dest.rows(BALLOON_DOCUMENTS_STORE), []); assert.deepEqual(dest.rows(BALLOON_DOCUMENT_FILES_STORE), []);
 signed('B'); assert.equal((await run(env, 'B')).state, 'CLAIMED_OTHER'); signed('A'); assert.equal((await run(env, 'A', outbox)).state, 'COMPLETE'); assert.equal(dest.rows(BALLOON_DOCUMENTS_STORE).length, 1); assert.equal(await dest.rows(BALLOON_DOCUMENT_FILES_STORE)[0].file.text(), 'G1'); assert.equal((await outbox.list()).length, 2);
});

test('new opening balance manifest for same owner fills only its empty destination', async () => {
 const env = setup(), completion = 'balloon-companion-flight-completion-v1'; env.storage.setItem(guestBusinessStorageKey(completion), JSON.stringify({ openingBalance: {}, journalFlights: [{ id: 'j1', sourceFlightId: 'f1' }], officialAscensions: [] })); await run(env);
 env.storage.setItem(guestBusinessStorageKey(completion), JSON.stringify({ openingBalance: { confirmed: true, ascensions: 5, officialDurationMinutes: 60 }, journalFlights: [{ id: 'j1', sourceFlightId: 'f1' }], officialAscensions: [] })); const result = await run(env); assert.equal(result.state, 'COMPLETE'); assert.equal(JSON.parse(env.storage.getItem(accountKey('A', completion))).openingBalance.ascensions, 5); assert.equal(JSON.parse(env.storage.getItem(accountKey('A', completion))).journalFlights.length, 1);
});

test('new manifest cannot hide unresolved import collisions from an earlier manifest', async () => {
 const env = setup(), balloons = 'balloon-companion-balloons'; env.storage.setItem(guestBusinessStorageKey(balloons), JSON.stringify({ balloons: [{ id: 'b1', registration: 'GUEST' }] }));
 const manifest = await makeGuestManifest((await inspectGuestSources(env.storage, env.factory, () => {})).entries); await acquireGuestImportClaim(env.factory, manifest, 'A', 'D', () => {}); env.storage.setItem(accountKey('A', balloons), JSON.stringify({ balloons: [{ id: 'b1', registration: 'USER' }] })); assert.equal((await run(env)).state, 'COMPLETE_WITH_COLLISIONS');
 env.storage.setItem(guestBusinessStorageKey('balloon-companion-favorite-weather-places-v1'), JSON.stringify({ favorites: [{ id: 'G2' }] })); assert.equal((await run(env)).state, 'COMPLETE_WITH_COLLISIONS'); assert.equal((await run(env)).state, 'COMPLETE_WITH_COLLISIONS');
});

for (const [label, left, right] of [
 ['NaN/null', {x: NaN}, {x: null}], ['undefined/absent', {x: undefined}, {}], ['negative zero/zero', {x: -0}, {x: 0}],
 ['positive/negative infinity', Infinity, -Infinity], ['positive infinity/NaN', Infinity, NaN], ['negative infinity/NaN', -Infinity, NaN],
 ['array order', [1, 2], [2, 1]], ['array hole/undefined', Array(1), [undefined]],
 ['typed object/string', {x: 1}, '["object",[["x",["number","1"]]]]'],
 ['boolean/string', true, 'true'], ['number/string', 1, '1'],
 ['file MIME', new Blob(['same'], {type:'text/plain'}), new Blob(['same'], {type:'application/pdf'})],
]) test(`typed canonical hash distinguishes ${label}`, async () => { assert.notEqual(await fingerprint(left), await fingerprint(right)); });
test('valid structured clones and object key order have stable typed hashes', async () => {
 const value = {b: [null, undefined, true, -0, 12.5, {z:'GPS', a:1}], a: new Blob(['same'], {type:'text/plain'})};
 assert.equal(await fingerprint(value), await fingerprint(structuredClone(value)));
 assert.equal(await fingerprint(value), await fingerprint({a:value.a, b:value.b}));
 assert.notEqual(await fingerprint(JSON.parse('{"__proto__":null}')), await fingerprint({}));
});
test('same business ID in different domains has distinct identities', async () => {
 const env = setup();
 env.storage.setItem(guestBusinessStorageKey('balloon-companion-balloons'), JSON.stringify({balloons:[{id:'same'}]}));
 const docs = env.factory.db(scopedIndexedDbName('GUEST', BALLOON_DOCUMENT_DB_NAME));
 docs.seed(BALLOON_DOCUMENTS_STORE, {id:'same'}); docs.createObjectStore(BALLOON_DOCUMENT_FILES_STORE, {keyPath:'documentId'});
 const entries = (await inspectGuestSources(env.storage, env.factory, () => {})).entries.filter(e => e.value.id === 'same');
 assert.equal(entries.length, 2); assert.equal(new Set(entries.map(e => e.identity)).size, 2);
});
for (const [label, change] of [
 ['NaN coordinate', {latitude:NaN}], ['Infinity coordinate', {longitude:Infinity}], ['negative Infinity coordinate', {latitude:-Infinity}],
 ['NaN altitude', {altitudeMeters:NaN}], ['Infinity timestamp', {timestamp:Infinity}], ['missing coordinate', {latitude:undefined}],
 ['string coordinate', {longitude:'2'}], ['out of range', {latitude:91}],
]) for (const source of (label === 'NaN altitude' ? ['flight'] : ['flight', 'session'])) test(`invalid ${source} ${label} blocks before claim/import`, async () => {
 const env = setup(), point = {latitude:48, longitude:2, timestamp:1, ...change}, outbox = queue();
 if (source === 'flight') env.factory.db(scopedIndexedDbName('GUEST', RECORDED_FLIGHT_DB_NAME)).seed(RECORDED_FLIGHTS_STORE, {id:'invalid', points:[point]});
 else env.storage.setItem(guestBusinessStorageKey(FLIGHT_SESSION_KEY), JSON.stringify({status:'ACTIVE', points:[point]}));
 await assert.rejects(inspectGuestSources(env.storage, env.factory, () => {}), /INVALID/);
 assert.equal((await run(env, 'A', outbox)).state, 'IMPORT_BLOCKED'); assert.equal(claims(env).length, 0); assert.equal(outbox.values.length, 0);
 assert.equal(env.storage.getItem(accountKey('A')), null);
});
test('non-object GPS point and unsupported canonical structures fail safe', async () => {
 const env = setup(); env.factory.db(scopedIndexedDbName('GUEST', RECORDED_FLIGHT_DB_NAME)).seed(RECORDED_FLIGHTS_STORE, {id:'bad', points:[1]});
 assert.equal((await run(env)).state, 'IMPORT_BLOCKED'); assert.equal(claims(env).length, 0);
 const cyclic = {}; cyclic.self = cyclic;
 await assert.rejects(fingerprint(cyclic), /CYCLIC/); await assert.rejects(fingerprint(new Map()), /UNSUPPORTED/);
});

test('valid GPS session imports unchanged with finite numbers and unavailable nullable measurements', async () => {
 const env = setup(), session = {status:'ACTIVE', points:[{latitude:48, longitude:2, timestamp:1, altitude:null, speed:0, heading:0, accuracy:5, verticalAccuracy:null}]};
 env.storage.setItem(guestBusinessStorageKey(FLIGHT_SESSION_KEY), JSON.stringify(session));
 assert.equal((await run(env)).state, 'COMPLETE');
 assert.deepEqual(JSON.parse(env.storage.getItem(accountKey('A', FLIGHT_SESSION_KEY))), session);
 assert.equal(claims(env).length, 1); assert.equal((await run(env)).imported, 0);
});
