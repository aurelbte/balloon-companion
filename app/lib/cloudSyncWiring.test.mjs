import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("./cloudSyncService.ts", import.meta.url), "utf8");
const browser = readFileSync(new URL("./cloudSyncBrowser.ts", import.meta.url), "utf8");
const launch = readFileSync(new URL("./favoriteLaunchSites.ts", import.meta.url), "utf8");
const weather = readFileSync(new URL("./favoriteWeatherPlaces.ts", import.meta.url), "utf8");
const newBalloonPage = readFileSync(new URL("../more/profile/balloons/new/page.tsx", import.meta.url), "utf8");
const editBalloonPage = readFileSync(new URL("../more/profile/balloons/[id]/edit/page.tsx", import.meta.url), "utf8");
const balloonPage = readFileSync(new URL("../more/profile/balloons/[id]/page.tsx", import.meta.url), "utf8");
const recordedFlightStorage = readFileSync(new URL("./recordedFlightStorage.ts", import.meta.url), "utf8");
const flightPage = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
const flightCompletePage = readFileSync(new URL("../flight/complete/page.tsx", import.meta.url), "utf8");

test("le runtime utilise des déclencheurs événementiels sans polling", () => {
  assert.match(layout, /<Suspense fallback=\{null\}><CloudSyncRuntime \/><\/Suspense>/);
  assert.match(runtime, /auth\.state !== "SIGNED_IN"/);
  assert.match(runtime, /addEventListener\("online"/);
  assert.match(runtime, /SYNC_MUTATION_ENQUEUED_EVENT/);
  assert.match(runtime, /new CloudSyncRuntimeController/);
  assert.match(runtime, /automaticCloudSyncController\.setUser\(userId\)/);
  assert.match(runtime, /automaticCloudSyncController\.notifyOnline\(\)/);
  assert.match(runtime, /automaticCloudSyncController\.notifyLocalMutation\(\)/);
  assert.doesNotMatch(runtime, /activePasses|pendingPasses|runPass\(/);
  assert.doesNotMatch(runtime, /setInterval|poll/i);
  assert.match(runtime, /addEventListener\("visibilitychange"/);
  assert.doesNotMatch(runtime, /addEventListener\("focus"/);
  assert.match(runtime, /suppressRuntimeDiagnosticPersistence = true[\s\S]*automaticCloudSyncController\.setUser\(null\)/);
  assert.match(runtime, /__BC_CLOUD_SYNC_CONTROLLED_TEST__/);
  assert.match(runtime, /useSearchParams\(\)/);
  assert.match(runtime, /\[auth\.state, auth\.user, currentSearch\]/);
});

test("le harness ciblé suit la query sur toutes les routes sans exposition globale", () => {
  assert.match(runtime, /controlledTestMode\(currentSearch \? `\?\$\{currentSearch\}` : ""\)/);
  assert.match(runtime, /if \(controlledApi\) window\.__BC_CLOUD_SYNC_CONTROLLED_TEST__ = controlledApi/);
  assert.match(runtime, /delete window\.__BC_CLOUD_SYNC_CONTROLLED_TEST__/);
});

test("le diagnostic runtime targeted est read-only et réutilise le contrôleur production", () => {
  assert.match(runtime, /inspectCloudSyncRuntimeControllerState/);
  assert.match(runtime, /automaticCloudSyncController\.inspect\(\)/);
  assert.match(runtime, /sessionStorage\.getItem\(CLOUD_SYNC_RUNTIME_DIAGNOSTIC_KEY\)/);
  const helper = runtime.match(/function inspectCloudSyncRuntimeControllerState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /bootstrapCloudDataForCurrentUser|syncPendingMutations|syncMutationById|\.rpc\(|\.enqueue\(|\.remove\(|\.setMetadata\(/);
});

test("l'inspection flight/logbook automatique est strictement read-only", () => {
  assert.match(runtime, /inspectFlightLogbookAutoPushTestState/);
  assert.match(runtime, /BC AUTO CLOUD TEST/);
  const helper = runtime.match(/async function inspectFlightLogbookAutoPushTestState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /entityType === "flight"/);
  assert.match(helper, /entityType === "logbook-entry"/);
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|bootstrapCloudDataForCurrentUser|\.rpc\(|\.enqueue\(|\.remove\(|\.setMetadata\(|save[A-Z]|persist[A-Z]|delete[A-Z]/);
});

test("le harness ciblé crée une ascension locale DEV sans appeler le service Cloud", () => {
  assert.match(runtime, /createLocalOfficialAscensionTest\(\)/);
  assert.match(runtime, /persistManualOfficialAscension\(\{/);
  assert.match(runtime, /BC CLOUD TARGETED TEST — LOCAL ONLY/);
  assert.match(runtime, /entityType === "logbook-entry"/);
  const helper = runtime.match(/async function createLocalOfficialAscensionTest[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
});

test("le harness ciblé modifie et supprime la dernière ascension locale de test", () => {
  assert.match(runtime, /updateLocalOfficialAscensionTest\(\)/);
  assert.match(runtime, /persistOfficialAscensionUpdate\(id, \{ \.\.\.input, observations: "BC CLOUD TARGETED TEST — UPDATED" \}\)/);
  assert.match(runtime, /deleteLocalOfficialAscensionTest\(\)/);
  assert.match(runtime, /saveFlightCompletionState\(removeOfficialAscension\(loadFlightCompletionState\(\), ascension\.id\)\)/);
  assert.match(runtime, /waitForLocalLogbookMutation\(scope, id, "UPSERT"\)/);
  assert.match(runtime, /waitForLocalLogbookMutation\(scope, ascension\.id, "DELETE"\)/);
  for (const helperName of ["updateLocalOfficialAscensionTest", "deleteLocalOfficialAscensionTest"]) {
    const helper = runtime.match(new RegExp(`async function ${helperName}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.doesNotMatch(helper, /createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
  }
});

test("le harness ciblé crée, modifie et supprime un ballon via le stockage métier", () => {
  assert.match(runtime, /createLocalBalloonTest\(\)/);
  assert.match(runtime, /await addBalloon\(\{/);
  assert.match(runtime, /registration: "F-BCTT"/);
  assert.match(runtime, /manufacturer: "BC CLOUD TARGETED TEST"/);
  assert.match(runtime, /updateLocalBalloonTest\(\)/);
  assert.match(runtime, /await editBalloon\(balloon\.id, \{/);
  assert.match(runtime, /model: "UPDATED"/);
  assert.match(runtime, /deleteLocalBalloonTest\(\)/);
  assert.match(runtime, /await deleteBalloon\(balloon\.id\)/);
  assert.match(runtime, /candidate\.entityType === "balloon"/);
  for (const helperName of ["createLocalBalloonTest", "updateLocalBalloonTest", "deleteLocalBalloonTest"]) {
    const helper = runtime.match(new RegExp(`async function ${helperName}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.doesNotMatch(helper, /createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
  }
});

test("le harness ciblé crée un document métadonnées-only pour un ballon déjà synchronisé", () => {
  const documentStorage = readFileSync(new URL("./balloonDocumentStorage.ts", import.meta.url), "utf8");
  assert.match(runtime, /createLocalDocumentTest\(\)/);
  assert.match(runtime, /getMetadata\("balloon", balloon\.id\)/);
  assert.match(runtime, /mutation\.entityType === "balloon" && mutation\.entityId === balloon\.id/);
  assert.match(runtime, /title: "BC CLOUD DOCUMENT TARGETED TEST"/);
  assert.match(runtime, /notes: "BC CLOUD TARGETED TEST — METADATA ONLY"/);
  assert.match(runtime, /originalFileName: "bc-cloud-document-test\.pdf"/);
  assert.match(runtime, /candidate\.entityType === "balloon-document"/);
  const helper = runtime.match(/async function createLocalDocumentTest[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
  const metadataWriter = documentStorage.match(/async addMetadataOnlyDocumentForCloudTest[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(metadataWriter, /database\.transaction\(DOCUMENTS_STORE, "readwrite"\)/);
  assert.doesNotMatch(metadataWriter, /FILES_STORE|\bFile\b|\.file\b/);
  assert.match(metadataWriter, /await enqueueLocalSyncMutation\("balloon-document", id\)/);
});

test("le harness ciblé crée un nouveau ballon parent réservé aux documents", () => {
  assert.match(runtime, /createLocalDocumentParentBalloonTest\(\)/);
  assert.match(runtime, /registration: "F-BCDT"/);
  assert.match(runtime, /model: "BC DOCUMENT PARENT TEST"/);
  assert.match(runtime, /await addBalloon\(\{/);
  assert.match(runtime, /waitForLocalBalloonMutation\(scope, balloon\.id, "UPSERT"\)/);
  const helper = runtime.match(/async function createLocalDocumentParentBalloonTest[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /some\(\(balloon\) => balloon\.registration === "F-BCDT"\)/);
  assert.doesNotMatch(helper, /deleteBalloon|createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
});

test("le harness ciblé modifie et supprime le dernier document de test via le stockage métier", () => {
  assert.match(runtime, /updateLocalDocumentTest\(\)/);
  assert.match(runtime, /deleteLocalDocumentTest\(\)/);
  assert.match(runtime, /balloonDocumentStorage\.updateDocument\(document\.id, \{/);
  assert.match(runtime, /title: "BC CLOUD DOCUMENT TARGETED TEST — UPDATED"/);
  assert.match(runtime, /notes: "BC CLOUD TARGETED TEST — METADATA UPDATED"/);
  assert.match(runtime, /balloonDocumentStorage\.deleteDocument\(document\.id\)/);
  assert.match(runtime, /waitForLocalDocumentMutation\(scope, document\.id, "UPSERT"\)/);
  assert.match(runtime, /waitForLocalDocumentMutation\(scope, document\.id, "DELETE"\)/);
  for (const helperName of ["updateLocalDocumentTest", "deleteLocalDocumentTest"]) {
    const helper = runtime.match(new RegExp(`async function ${helperName}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.doesNotMatch(helper, /getDocumentFile|replaceDocumentFile|createBrowserCloudSyncService|createBrowserSupabaseClient|syncMutationById|\.rpc\(/);
  }
});

test("le harness ciblé crée, modifie et supprime un vol terminé sans Journal ni trace", () => {
  assert.match(runtime, /createLocalFlightTest\(\)/);
  assert.match(runtime, /updateLocalFlightTest\(\)/);
  assert.match(runtime, /deleteLocalFlightTest\(\)/);
  assert.match(runtime, /finalizeRecordedFlight\(createRecordedFlight\(\{ startedAt \}\), startedAt \+ 42 \* 60_000\)/);
  assert.match(runtime, /generatedTitle: "BC CLOUD FLIGHT TARGETED TEST"/);
  assert.match(runtime, /startLocationLabel: "BC TEST DEPART"/);
  assert.match(runtime, /new IndexedDbRecordedFlightStorage\(\)\.completeFlight\(flight\)/);
  assert.match(runtime, /new IndexedDbRecordedFlightStorage\(\)\.updateFlightNotes/);
  assert.match(runtime, /new IndexedDbRecordedFlightStorage\(\)\.deleteFlight\(flight\.id\)/);
  assert.match(runtime, /candidate\.entityType === "flight" && candidate\.entityId === flightId/);
  for (const helperName of ["createLocalFlightTest", "updateLocalFlightTest", "deleteLocalFlightTest"]) {
    const helper = runtime.match(new RegExp(`async function ${helperName}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.doesNotMatch(helper, /persistRecordedFlightInJournal|saveFlightCompletionState|logbook-entry|flight-completion|createBrowserCloudSyncService|syncMutationById|syncPendingMutations|\.rpc\(/);
  }
});

test("le batch Cloud restant ne synchronise que ses mutationId et protège les données réelles", () => {
  assert.match(runtime, /runRemainingCloudTargetedTests\(\)/);
  assert.match(runtime, /const oldMutations = new Map/);
  assert.match(runtime, /oldMutations\.has\(mutation\.mutationId\)/);
  assert.match(runtime, /await syncById\(mutation\.mutationId\)/);
  assert.match(runtime, /result\.state !== "COMPLETED" \|\| result\.applied !== 1/);
  assert.match(runtime, /metadata\?\.revision !== expectedRevision/);
  assert.match(runtime, /createLocalFlightTest\(scope\)/);
  assert.match(runtime, /saveFavoriteWeatherPlacesWithDurableOutbox/);
  assert.match(runtime, /saveFavoriteLaunchSites/);
  assert.match(runtime, /profile: \{ status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" \}/);
  assert.match(runtime, /user_preferences: \{ status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" \}/);
  assert.match(runtime, /aviation_preferences: \{ status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" \}/);
  const batch = runtime.match(/async function runRemainingCloudTargetedTests[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(batch, /syncPendingMutations|remove\(mutation|deleteDatabase|object_key|blob_status/);
  assert.match(batch, /cloudGpsTrace: false/);
});

test("le batch protégé restaure les préférences et refuse profil ou mutation préexistante", () => {
  assert.match(runtime, /runProtectedUserDataCloudTargetedTests\(\)/);
  assert.match(runtime, /reason: "NO_SAFE_NON_CRITICAL_FIELD"/);
  assert.match(runtime, /reason: "PREEXISTING_MUTATION"/);
  assert.match(runtime, /reason: "UNINITIALIZED_LOCAL_STATE"/);
  assert.match(runtime, /distanceUnit: \(snapshot\.flightInstruments\.distanceUnit === "km" \? "NM" : "km"\)/);
  assert.match(runtime, /weatherModel: snapshot\.weatherModel === "arome_seamless" \? "icon_seamless" : "arome_seamless"/);
  assert.match(runtime, /BC CLOUD AVIATION TARGETED TEST/);
  assert.match(runtime, /input\.save\(structuredClone\(snapshot\)\)/);
  assert.match(runtime, /JSON\.stringify\(input\.load\(\)\) === snapshotSerialized/);
  assert.match(runtime, /oldMutations\.has\(mutation\.mutationId\)/);
  assert.match(runtime, /await syncById\(mutation\.mutationId\)/);
  assert.match(runtime, /mutation\.baseRevision === 0 \? \[0, 1\] : \[mutation\.baseRevision \+ 1\]/);
  assert.match(runtime, /expectedRevisions\.includes\(afterMetadata\.revision\)/);
  const batch = runtime.match(/async function runProtectedUserDataCloudTargetedTests[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(batch, /syncPendingMutations|deleteDatabase|remove\(mutation|addBalloon|RecordedFlight|FavoriteWeatherPlace|FavoriteLaunchSite|OfficialAscension|Document/);
});

test("l’audit protégé lit uniquement les deux domaines de préférences demandés", () => {
  assert.match(runtime, /auditProtectedPreferenceMutations\(\)/);
  assert.match(runtime, /\["weather-preferences", "aviation-preferences"\] as const/);
  assert.match(runtime, /await outbox\.list\(\)/);
  assert.match(runtime, /await payloads\.build\(mutation\)/);
  assert.match(runtime, /source: "CURRENT_LOCAL_STATE_AT_AUDIT"/);
  assert.match(runtime, /multipleForEntityType: candidates\.length > 1/);
  const helper = runtime.match(/async function auditProtectedPreferenceMutations[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.remove\(|\.setMetadata\(|\.markAttempt\(|\.updateMutation\(|save[A-Z]|writeScoped/);
  for (const forbidden of ["pilot-profile", "favorite-weather-place", "favorite-launch-site", "flight", "balloon", "logbook-entry", "balloon-document"]) {
    assert.doesNotMatch(helper, new RegExp(`"${forbidden}"`));
  }
});

test("l’inspection de conflit protégée est read-only côté local et Cloud", () => {
  assert.match(runtime, /inspectProtectedPreferenceConflictState\(\)/);
  assert.match(runtime, /new BrowserCloudSyncIssueRepository\(window\.localStorage, scope\)\.list\(\)/);
  assert.match(runtime, /\.select\("id,revision,updated_at,deleted_at"\)/);
  assert.match(runtime, /\.maybeSingle\(\)/);
  assert.match(runtime, /localSidecar: await outbox\.getMetadata/);
  assert.match(runtime, /eligibleForCoalescing: mutation\.attempts === 0/);
  const helper = runtime.match(/async function inspectProtectedPreferenceConflictState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.enqueue\(|\.remove\(|\.setMetadata\(|\.markAttempt\(|\.updateMutation\(|save[A-Z]|writeScoped/);
  for (const forbidden of ["profiles", "flights", "balloons", "documents", "logbook_entries", "favorite_weather_places", "favorite_launch_sites"]) {
    assert.doesNotMatch(helper, new RegExp(`"${forbidden}"`));
  }
});

test("le helper LOCAL WINS délègue au mécanisme de production sans drain global", () => {
  assert.match(runtime, /resolveProtectedPreferenceConflictLocalWins\(entityType/);
  assert.match(runtime, /resolveProtectedPreferenceConflictLocalWins: resolveProtectedConflict/);
  assert.match(runtime, /syncMutationById: syncTargetedMutationById/);
  assert.match(runtime, /readCloudState: async/);
  const helper = runtime.match(/const resolveProtectedConflict[\s\S]*?\n    \};/)?.[0] ?? "";
  assert.doesNotMatch(helper, /syncPendingMutations|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("l’audit Cloud final inventorie uniquement en lecture les mutations et sidecars prioritaires", () => {
  assert.match(runtime, /auditCloudSyncFinalState\(\)/);
  assert.match(runtime, /const mutations = await outbox\.list\(\)/);
  assert.match(runtime, /const sidecars = await outbox\.listMetadata\(\)/);
  for (const domain of ["balloon", "flight", "logbook_entry", "document", "favorite_weather_place", "favorite_launch_site", "unit_preferences", "weather_preferences", "aviation_preferences", "profile"]) {
    assert.match(runtime, new RegExp(`reportKey: "${domain}"`));
  }
  assert.match(runtime, /expectedMinimumRevision: 2/);
  assert.match(runtime, /mutation\.lastErrorCode === "CONFLICT"/);
  assert.match(runtime, /isLegacyLocalOnlyMutation\(mutation\)/);
  assert.match(runtime, /!localOnly && mutation\.operation === "UPSERT" && currentPayload === null/);
  assert.match(runtime, /localOnlyMutations/);
  assert.match(runtime, /BC CLOUD\|TARGETED TEST/);
  const helper = runtime.match(/async function auditCloudSyncFinalState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(helper, /syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.enqueue\(|\.remove\(|\.removeMany\(|\.setMetadata\(|\.markAttempt\(|\.updateMutation\(|save[A-Z]|writeScoped/);
});

test("la liste blanche automatique inclut les domaines métier validés", () => {
  const allowedBlock = service.match(/AUTOMATIC_SYNC_ENTITY_TYPES = Object\.freeze\(\[\.\.\.PHASE_3A_SYNC_ENTITY_TYPES,([^\]]+)/)?.[1] ?? "";
  for (const allowed of ["balloon", "flight", "logbook-entry", "balloon-document"]) assert.match(allowedBlock, new RegExp(allowed));
  for (const forbidden of ["recorded-flight", "flight-completion"]) assert.doesNotMatch(allowedBlock, new RegExp(forbidden));
});

test("3B conserve les mêmes domaines via syncMutationById", () => {
  assert.match(service, /PHASE_3B_TARGETED_SYNC_ENTITY_TYPES/);
  assert.match(service, /PHASE_3B_TARGETED_SYNC_ENTITY_TYPES = AUTOMATIC_SYNC_ENTITY_TYPES/);
  assert.match(service, /syncPendingMutations[\s\S]*AUTOMATIC_ALLOWED_TYPES/);
  assert.match(service, /syncMutationById[\s\S]*TARGETED_ALLOWED_TYPES/);
});

test("3B.2 produit des mutations flight durables et conserve le mode targeted", () => {
  assert.match(recordedFlightStorage, /await enqueueLocalSyncMutation\("flight", flight\.id\)/);
  assert.match(recordedFlightStorage, /enqueueDelete: \(\) => enqueueLocalSyncMutation\("flight", id, "DELETE"\)/);
  assert.doesNotMatch(recordedFlightStorage, /enqueueLocalSyncMutation\("recorded-flight"/);
  for (const page of [flightPage, flightCompletePage]) {
    assert.match(page, /cloudSyncTest/);
    assert.match(page, /targeted/);
  }
});

test("les actions ballon conservent le mode targeted après navigation", () => {
  for (const page of [newBalloonPage, editBalloonPage, balloonPage]) {
    assert.match(page, /cloudSyncTest/);
    assert.match(page, /targeted/);
  }
});

test("les favoris Prépa et Météo produisent des mutations par ligne distinctes", () => {
  assert.match(launch, /enqueueLocalSyncMutation\("favorite-launch-site", favorite\.id\)/);
  assert.match(launch, /enqueueLocalSyncMutation\("favorite-launch-site", removed\.id, "DELETE"\)/);
  assert.match(weather, /enqueueLocalSyncMutation\("favorite-weather-place", favorite\.id\)/);
  assert.match(weather, /enqueueLocalSyncMutation\("favorite-weather-place", removed\.id, "DELETE"\)/);
  assert.doesNotMatch(`${launch}\n${weather}`, /enqueueLocalSyncMutation\("favorite-(launch|weather)-places"/);
});

test("modifier et supprimer un favori Météo réutilisent les UPSERT et DELETE existants", () => {
  assert.match(weather, /renameFavoriteWeatherPlace/);
  assert.match(weather, /removeFavoriteWeatherPlace/);
  assert.match(weather, /JSON\.stringify\(prior\) !== JSON\.stringify\(favorite\).*enqueueLocalSyncMutation\("favorite-weather-place", favorite\.id\)/s);
  assert.match(weather, /enqueueLocalSyncMutation\("favorite-weather-place", removed\.id, "DELETE"\)/);
});

test("le scan initial reste une API explicite sans déclenchement automatique", () => {
  assert.match(browser, /export async function scanInitialCloudSyncInventory/);
  assert.match(browser, /Read-only and idempotent/);
  assert.doesNotMatch(runtime, /scanInitialCloudSyncInventory/);
});

test("aucun payload Phase 3A ne contient trace GPS ou métadonnée Blob", () => {
  for (const forbidden of ["storage_provider", "object_key", "checksum", "blob_status", "points:", "trace:"]) {
    assert.doesNotMatch(browser, new RegExp(forbidden, "i"));
  }
});
