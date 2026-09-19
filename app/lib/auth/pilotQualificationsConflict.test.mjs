import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { memoryFactory, memoryStorage } from "./guestImportTestHarness.mjs";
import { guestBusinessStorageKey, scopedBusinessStorageKey, setRuntimeAuthSnapshot } from "./dataScopeRuntime.ts";
import {
  GUEST_TO_USER_MIGRATION_KEY,
  listPilotQualificationsProfileConflicts,
  migrateGuestAndLegacyToUser,
  resolvePilotQualificationsProfileConflict,
} from "./guestToUserMigration.ts";
import { PILOT_QUALIFICATIONS_STORAGE_KEY } from "../pilotQualificationsStorage.ts";
import { pendingSyncIntents } from "../durableSyncIntent.ts";
import { readPilotQualificationsProfileFromCloud } from "../pilotQualificationsCloudReader.ts";
import { CloudSyncRuntimeController } from "../cloudSyncRuntimeController.ts";
import { inspectGuestSources, makeGuestManifest } from "./guestImportManifest.ts";
import { acquireGuestImportClaim } from "./guestImportClaim.ts";

const scope = "USER:A";
const accountKey = scopedBusinessStorageKey(scope, PILOT_QUALIFICATIONS_STORAGE_KEY);
const guestKey = guestBusinessStorageKey(PILOT_QUALIFICATIONS_STORAGE_KEY);
const profile = (licenceType) => ({ configured: true, licenceType, bplBalloonClasses: ["HOT_AIR_BALLOON"], hotAirBalloonGroupPrivilege: "GROUP_A", commercialOperationsEnabled: false, commercialBalloonClasses: [], commercialHotAirBalloonGroupPrivilege: null, fiBEnabled: false, feBEnabled: false, historyCoverageStartDate: null, declaredBplInitialSituation: { referenceDateIso: null, recentExperienceSatisfied: null }, declaredCommercialInitialSituations: [] });
const state = (licenceType, events = []) => ({ version: 1, profile: profile(licenceType), events });
const existingEvent = { id: "11111111-1111-4111-8111-111111111111", type: "MEDICAL", dateIso: "2026-01-01", source: "MANUAL", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

async function setup() {
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "A" } });
  const storage = memoryStorage({ [guestKey]: JSON.stringify(state("LOCAL")) });
  const factory = memoryFactory();
  const manifest = await makeGuestManifest((await inspectGuestSources(storage, factory, () => {})).entries);
  await acquireGuestImportClaim(factory, manifest, "A", "D", () => {});
  storage.setItem(accountKey, JSON.stringify(state("CLOUD", [existingEvent])));
  const report = await migrateGuestAndLegacyToUser({ userId: "A", deviceId: "D", storage, factory, outbox: { getScope: () => scope, enqueue: async value => ({ ...value, mutationId: "m" }) } });
  assert.equal(report.state, "COMPLETE_WITH_COLLISIONS");
  const cloudProfile = profile("SERVER");
  const readCloudProfile = async () => cloudProfile;
  const conflicts = await listPilotQualificationsProfileConflicts({ userId: "A", storage, factory, readCloudProfile });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].deviceProfile.licenceType, "LOCAL");
  assert.equal(conflicts[0].cloudProfile.licenceType, "SERVER");
  return { storage, factory, conflict: conflicts[0], readCloudProfile };
}

test("choix appareil persiste le profil local, conserve les événements et retire seulement ce conflit", async () => {
  const env = await setup();
  const remaining = await resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "DEVICE", storage: env.storage, factory: env.factory, readCloudProfile: env.readCloudProfile });
  const saved = JSON.parse(env.storage.getItem(accountKey));
  assert.equal(saved.profile.licenceType, "LOCAL");
  assert.deepEqual(saved.events, [existingEvent]);
  assert.equal(pendingSyncIntents(saved).some(intent => intent.entityType === "pilot-qualifications" && intent.entityId === "singleton"), true);
  assert.deepEqual(remaining, []);
  assert.equal(env.storage.getItem(guestKey), JSON.stringify(state("LOCAL")));
});

test("choix Cloud persiste exactement le profil serveur relu et retire le conflit", async () => {
  const env = await setup();
  const remaining = await resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "CLOUD", storage: env.storage, factory: env.factory, readCloudProfile: env.readCloudProfile });
  const saved = JSON.parse(env.storage.getItem(accountKey));
  assert.equal(saved.profile.licenceType, "SERVER");
  assert.deepEqual(saved.events, [existingEvent]);
  assert.equal(pendingSyncIntents(saved).some(intent => intent.entityType === "pilot-qualifications"), true);
  assert.deepEqual(remaining, []);
});

test("annulation UI ne déclenche aucune résolution et aucune option n'est présélectionnée", async () => {
  const page = await readFile(new URL("../../more/cloud-sync/page.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<Readonly<\{ conflictId: string; strategy: "DEVICE" \| "CLOUD" \}> \| null>\(null\)/);
  assert.match(page, /onClick=\{\(\) => setQualificationChoice\(null\)\}>Annuler/);
  assert.doesNotMatch(page, /defaultChecked|checked=/);
});

test("échec d'écriture du marqueur conserve le conflit", async () => {
  const env = await setup(); const setItem = env.storage.setItem; let fail = true;
  env.storage.setItem = (key, value) => { if (fail && key === GUEST_TO_USER_MIGRATION_KEY) { fail = false; throw new Error("storage failed"); } setItem(key, value); };
  await assert.rejects(resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "CLOUD", storage: env.storage, factory: env.factory, readCloudProfile: env.readCloudProfile }));
  const history = JSON.parse(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY));
  assert.equal(Object.values(history)[0].collisions.some(collision => collision.domain === "pilot-qualifications-profile"), true);
});

test("résoudre les qualifications ne supprime aucun autre conflit", async () => {
  const env = await setup(); const history = JSON.parse(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY)); const key = Object.keys(history)[0];
  history[key].collisions.push({ domain: "balloon", entityId: "b1", source: "GUEST", reason: "DUPLICATE_REGISTRATION" }); env.storage.setItem(GUEST_TO_USER_MIGRATION_KEY, JSON.stringify(history));
  const remaining = await resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "CLOUD", storage: env.storage, factory: env.factory, readCloudProfile: env.readCloudProfile });
  assert.deepEqual(remaining, [{ domain: "balloon", entityId: "b1", source: "GUEST", reason: "DUPLICATE_REGISTRATION" }]);
});

test("Auth ne libère le gate Cloud qu'après disparition du dernier conflit", async () => {
  const [auth, runtime] = await Promise.all([readFile(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8"), readFile(new URL("../../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8")]);
  assert.match(auth, /setLocalDataMigrationCollisions\(remaining\)/);
  assert.match(auth, /remaining\.length \? "COMPLETE_WITH_COLLISIONS" : "COMPLETE"/);
  assert.match(runtime, /auth\.localDataMigrationCollisions\.length > 0/);
});

test("serveur inaccessible bloque la comparaison et toute résolution", async () => {
  const env = await setup();
  const unavailable = async () => { throw new Error("offline"); };
  await assert.rejects(listPilotQualificationsProfileConflicts({ userId: "A", storage: env.storage, factory: env.factory, readCloudProfile: unavailable }));
  await assert.rejects(resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "CLOUD", storage: env.storage, factory: env.factory, readCloudProfile: unavailable }));
  assert.equal(JSON.parse(env.storage.getItem(accountKey)).profile.licenceType, "CLOUD");
  assert.equal(JSON.parse(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY)) && true, true);
});

test("confirmation périmée est refusée si le profil Cloud change", async () => {
  const env = await setup();
  await assert.rejects(resolvePilotQualificationsProfileConflict({ userId: "A", conflictId: env.conflict.id, strategy: "CLOUD", storage: env.storage, factory: env.factory, readCloudProfile: async () => profile("SERVER-CHANGED") }), /NOT_FOUND/);
  assert.equal(JSON.parse(env.storage.getItem(accountKey)).profile.licenceType, "CLOUD");
  const history = JSON.parse(env.storage.getItem(GUEST_TO_USER_MIGRATION_KEY));
  assert.equal(Object.values(history)[0].collisions.some(collision => collision.domain === "pilot-qualifications-profile"), true);
});

test("le lecteur Cloud utilise la ligne serveur qualifications authentifiée, jamais le cache local", async () => {
  const calls = [];
  const result = { data: { id: "qualifications", user_id: "A", preferences: state("REMOTE"), deleted_at: null }, error: null };
  const query = { select(value) { calls.push(["select", value]); return this; }, eq(column, value) { calls.push(["eq", column, value]); return this; }, async maybeSingle() { calls.push(["maybeSingle"]); return result; } };
  const client = { auth: { getUser: async () => ({ data: { user: { id: "A" } }, error: null }) }, from(table) { calls.push(["from", table]); return query; } };
  const remote = await readPilotQualificationsProfileFromCloud({ client, userId: "A" });
  assert.equal(remote.licenceType, "REMOTE");
  assert.deepEqual(calls.map(call => call[0]), ["from", "select", "eq", "maybeSingle"]);
  assert.deepEqual(calls[2], ["eq", "id", "qualifications"]);
});

test("le lecteur Cloud refuse une session d'un autre compte", async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: "B" } }, error: null }) }, from() { throw new Error("query must not run"); } };
  await assert.rejects(readPilotQualificationsProfileFromCloud({ client, userId: "A" }), /AUTH_UNAVAILABLE/);
});

test("résolution B6 ne simule pas un changement de scope et le runtime reprend seulement après setUser", async () => {
  const auth = await readFile(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");
  const start = auth.indexOf("const resolvePilotQualificationsConflict = useCallback");
  const end = auth.indexOf("const signUp = useCallback", start);
  const resolution = auth.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(resolution, /DATA_SCOPE_CHANGED_EVENT|retryCloudSyncThroughRuntimeController|notifyOnline/);
  assert.match(resolution, /setLocalDataMigrationCollisions\(remaining\)/);

  let bootstrap = 0, push = 0;
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { bootstrap += 1; return { state: "SUCCESS", resumable: false }; },
    push: async () => { push += 1; return { state: "COMPLETED" }; },
  });
  controller.notifyOnline();
  await controller.whenIdle();
  assert.deepEqual([bootstrap, push], [0, 0]);
  controller.setUser("A");
  await controller.whenIdle();
  assert.deepEqual([bootstrap, push], [1, 1]);
  assert.equal(controller.inspect().scope, "USER:A");
  assert.equal(controller.inspect().lastPushState, "COMPLETED");
});
