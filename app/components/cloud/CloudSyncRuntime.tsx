"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { getRuntimeDataScope } from "../../lib/auth/dataScopeRuntime.ts";
import { BrowserCloudSyncIssueRepository, BrowserCloudSyncPayloadProvider, createBrowserCloudSyncService } from "../../lib/cloudSyncBrowser.ts";
import { createScopeUnavailableControlledApi, isAutomaticCloudSyncBlockedForControlledTest } from "../../lib/cloudSyncTestControl.ts";
import { createBrowserSupabaseClient } from "../../lib/supabase/client.ts";
import { addBalloon, deleteBalloon, editBalloon, loadBalloonRegistry } from "../../lib/balloonStorage.ts";
import { balloonDocumentStorage } from "../../lib/balloonDocumentStorage.ts";
import {
  addOrReuseFavoriteLaunchSite,
  loadFavoriteLaunchSites,
  removeFavoriteLaunchSite,
  renameFavoriteLaunchSite,
  saveFavoriteLaunchSites,
} from "../../lib/favoriteLaunchSites.ts";
import {
  addOrReuseFavoriteWeatherPlace,
  loadFavoriteWeatherPlaces,
  removeFavoriteWeatherPlace,
  renameFavoriteWeatherPlace,
  saveFavoriteWeatherPlacesWithDurableOutbox,
} from "../../lib/favoriteWeatherPlaces.ts";
import { removeOfficialAscension } from "../../lib/flightCompletion.ts";
import { createRecordedFlight, finalizeRecordedFlight } from "../../lib/recordedFlight.ts";
import { IndexedDbRecordedFlightStorage } from "../../lib/recordedFlightStorage.ts";
import { restoreRecordedFlightBackupTargeted } from "../../lib/recordedFlightBackupRestore.ts";
import { BrowserFlightTrackCloudService } from "../../lib/flightTrackCloudBrowser.ts";
import { migrateFlightTrackSupabaseToR2Targeted, migrateLegacyFlightTrackToR2Targeted, replayFlightTrackSupabaseToR2Targeted } from "../../lib/flightTrackBlobProvider.ts";
import { drainFlightTrackQueue, enqueueFlightTrackJob, FLIGHT_TRACK_QUEUE_CHANGED_EVENT, IndexedDbFlightTrackQueueStorage, isFlightTrackQueueRunning, nextFlightTrackRetryAt } from "../../lib/flightTrackQueue.ts";
import {
  loadFlightCompletionState,
  persistJournalFlight,
  persistManualOfficialAscension,
  persistOfficialAscensionUpdate,
  saveFlightCompletionState,
} from "../../lib/flightCompletionStorage.ts";
import { enqueueLocalSyncMutation, IndexedDbSyncOutboxStorage, SYNC_MUTATION_ENQUEUED_EVENT, type SyncMutation } from "../../lib/syncOutbox.ts";
import { nextEligibleRetryAt, type CloudSyncPassResult } from "../../lib/cloudSyncService.ts";
import { classifyFinalAuditMutations, isLegacyLocalOnlyMutation } from "../../lib/cloudSyncFinalAudit.ts";
import { createBrowserBalloonPullService, createBrowserDocumentPullService, createBrowserFavoriteLaunchSitePullService, createBrowserFavoriteWeatherPlacePullService, createBrowserFlightPullService, createBrowserLogbookEntryPullService, createBrowserPilotProfilePullService, createBrowserPreferencePullService } from "../../lib/cloudPullBrowser.ts";
import { createBrowserCloudBootstrapService } from "../../lib/cloudBootstrapBrowser.ts";
import { createBrowserCloudBackfillService } from "../../lib/cloudBackfillBrowser.ts";
import { CLOUD_BOOTSTRAP_DOMAIN_ORDER } from "../../lib/cloudBootstrapService.ts";
import { CloudSyncRuntimeController, type CloudSyncRuntimeControllerSnapshot } from "../../lib/cloudSyncRuntimeController.ts";
import { BrowserCloudPullCursorRepository } from "../../lib/cloudPullState.ts";
import { FAVORITE_LAUNCH_SITE_PULL_DOMAIN, FAVORITE_WEATHER_PLACE_PULL_DOMAIN } from "../../lib/cloudPullService.ts";
import { loadUnitPreferences, saveUnitPreferences } from "../../lib/unitPreferencesStorage.ts";
import { loadWeatherPreferences, saveWeatherPreferences } from "../../lib/weatherPreferencesStorage.ts";
import { loadAviationPreferences, saveAviationPreferences } from "../../lib/aviation/aviationPreferencesStorage.ts";
import { loadPilotProfile } from "../../lib/pilotProfileStorage.ts";
import {
  resolveProtectedPreferenceConflictLocalWins,
  type ProtectedPreferenceRebaseType,
} from "../../lib/protectedPreferenceConflictRebase.ts";
import { createBrowserCrudConflictResolver } from "../../lib/crudConflictBrowser.ts";

const lastCloudBootstrapReports = new Map<string, unknown>();
const CLOUD_SYNC_RUNTIME_DIAGNOSTIC_KEY = "balloon-companion:dev:cloud-sync-runtime-diagnostic";
export const CLOUD_SYNC_RUNTIME_CHANGED_EVENT = "balloon-companion:cloud-sync-runtime-changed";
let runtimeMountCount = 0;
let runtimeUnmountGeneration = 0;
let suppressRuntimeDiagnosticPersistence = false;
let manualCloudSyncInProgress = false;
let manualCloudSyncOperation: Promise<CloudSyncRuntimeControllerSnapshot> | null = null;

declare global {
  interface Window {
    __BC_CLOUD_SYNC_CONTROLLED_TEST__?: Readonly<{
      syncMutationById(mutationId: string): Promise<unknown>;
      createLocalOfficialAscensionTest(): Promise<Readonly<{ ascensionId: string; mutationId: string }>>;
      updateLocalOfficialAscensionTest(): Promise<Readonly<{ ascensionId: string; mutationId: string }>>;
      deleteLocalOfficialAscensionTest(): Promise<Readonly<{ ascensionId: string; mutationId: string }>>;
      createLocalBalloonTest(): Promise<Readonly<{ balloonId: string; mutationId: string }>>;
      updateLocalBalloonTest(): Promise<Readonly<{ balloonId: string; mutationId: string }>>;
      deleteLocalBalloonTest(): Promise<Readonly<{ balloonId: string; mutationId: string }>>;
      createLocalDocumentParentBalloonTest(): Promise<Readonly<{ balloonId: string; mutationId: string }>>;
      createLocalDocumentTest(): Promise<Readonly<{ documentId: string; mutationId: string }>>;
      updateLocalDocumentTest(): Promise<Readonly<{ documentId: string; mutationId: string }>>;
      deleteLocalDocumentTest(): Promise<Readonly<{ documentId: string; mutationId: string }>>;
      createLocalFlightTest(): Promise<Readonly<{ flightId: string; mutationId: string }>>;
      updateLocalFlightTest(): Promise<Readonly<{ flightId: string; mutationId: string }>>;
      deleteLocalFlightTest(): Promise<Readonly<{ flightId: string; mutationId: string }>>;
      runRemainingCloudTargetedTests(): Promise<unknown>;
      runProtectedUserDataCloudTargetedTests(): Promise<unknown>;
      auditProtectedPreferenceMutations(): Promise<unknown>;
      inspectProtectedPreferenceConflictState(): Promise<unknown>;
      resolveProtectedPreferenceConflictLocalWins(entityType: string): Promise<unknown>;
      auditCloudSyncFinalState(): Promise<unknown>;
      pullFavoriteWeatherPlacesTargeted(): Promise<unknown>;
      inspectFavoriteWeatherPullTestState(): Promise<unknown>;
      pullFavoriteLaunchSitesTargeted(): Promise<unknown>;
      inspectFavoriteLaunchSitePullState(): Promise<unknown>;
      pullPilotProfileTargeted(): Promise<unknown>;
      inspectPilotProfilePullState(): Promise<unknown>;
      pullUnitPreferencesTargeted(): Promise<unknown>;
      pullWeatherPreferencesTargeted(): Promise<unknown>;
      pullAviationPreferencesTargeted(): Promise<unknown>;
      inspectPreferencePullState(): Promise<unknown>;
      pullBalloonsTargeted(): Promise<unknown>;
      inspectBalloonPullState(): Promise<unknown>;
      pullFlightsTargeted(): Promise<unknown>;
      inspectFlightPullState(): Promise<unknown>;
      pullLogbookEntriesTargeted(): Promise<unknown>;
      inspectLogbookEntryPullState(): Promise<unknown>;
      pullDocumentsTargeted(): Promise<unknown>;
      inspectDocumentPullState(): Promise<unknown>;
      bootstrapCloudDataTargeted(): Promise<unknown>;
      inspectCloudBootstrapState(): Promise<unknown>;
      inspectCloudSyncRuntimeControllerState(): Promise<unknown>;
      inspectFlightLogbookAutoPushTestState(): Promise<unknown>;
      resolveCrudConflictLocalWins(entityType: string, entityId: string): Promise<unknown>;
      resolveCrudConflictServerWins(entityType: string, entityId: string): Promise<unknown>;
      restoreRecordedFlightBackupTargeted(backup: unknown): Promise<unknown>;
      inspectRecordedFlightBackupRestoreState(flightId: string): Promise<unknown>;
      inspectFlightTrackSyncState(flightId: string): Promise<unknown>;
      uploadFlightTrackTargeted(flightId: string): Promise<unknown>;
      downloadFlightTrackTargeted(flightId: string): Promise<unknown>;
      inspectFlightTrackQueueState(): Promise<unknown>;
      drainFlightTrackQueueTargeted(): Promise<unknown>;
      uploadFlightTrackToR2Targeted(flightId: string): Promise<unknown>;
      inspectFlightTrackR2TargetedState(flightId: string): Promise<unknown>;
      restoreFlightTrackFromR2Targeted(flightId: string): Promise<unknown>;
      inspectFlightTrackR2RestoreState(flightId: string): Promise<unknown>;
      migrateFlightTrackSupabaseToR2Targeted(flightId: string, generation?: number): Promise<unknown>;
      replayFlightTrackSupabaseToR2Targeted(flightId: string, generation?: number): Promise<unknown>;
      migrateLegacyFlightTrackToR2Targeted(flightId: string, generation?: number): Promise<unknown>;
    }>;
  }
}

function controlledTestMode(search = typeof window !== "undefined" ? window.location.search : ""): boolean {
  return isAutomaticCloudSyncBlockedForControlledTest(process.env.NODE_ENV, search);
}

const automaticCloudSyncController = new CloudSyncRuntimeController({
  isOnline: () => typeof navigator !== "undefined" && navigator.onLine,
  bootstrap: async (userId) => {
    const scope = `USER:${userId}` as const;
    const report = await createBrowserCloudBootstrapService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).bootstrapCloudDataForCurrentUser();
    if (report.state === "SUCCESS") {
      const backfill = await createBrowserCloudBackfillService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).run();
      if (backfill.state !== "COMPLETED") {
        const partialReport = {
        ...report,
        state: backfill.state === "OFFLINE" ? "OFFLINE" as const : backfill.state === "SESSION_INVALID" ? "SESSION_INVALID" as const : "PARTIAL" as const,
        resumable: true,
        };
        lastCloudBootstrapReports.set(scope, partialReport);
        return partialReport;
      }
    }
    lastCloudBootstrapReports.set(scope, report);
    return report;
  },
  push: async (userId) => {
    const scope = `USER:${userId}` as const;
    const client = createBrowserSupabaseClient();
    const report = await createBrowserCloudSyncService({ client, storage: window.localStorage, scope, getScope: getRuntimeDataScope }).syncPendingMutations();
    if (report.state !== "COMPLETED" || report.conflicts > 0) return;
    const tracks = new BrowserFlightTrackCloudService(client, scope);
    const queue = new IndexedDbFlightTrackQueueStorage(scope);
    try { await tracks.discoverPendingJobs(queue); }
    catch (error) { if (process.env.NODE_ENV === "development") console.error("[Cloud Sync] Découverte trace différée", error); }
    await drainFlightTrackQueue({ scope, storage: queue, transport: { upload: (id) => tracks.upload(id), download: (id) => tracks.download(id), cleanup: (id) => tracks.cleanup(id) } });
  },
  getNextEligibleRetryAt: async (userId) => {
    const scope = `USER:${userId}` as const;
    const [mutationRetry, trackRetry] = await Promise.all([
      nextEligibleRetryAt(await new IndexedDbSyncOutboxStorage(scope).list()),
      nextFlightTrackRetryAt(new IndexedDbFlightTrackQueueStorage(scope)),
    ]);
    return [mutationRetry, trackRetry].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  },
  onDiagnosticChange: (snapshot) => {
    if (process.env.NODE_ENV === "development" && !suppressRuntimeDiagnosticPersistence && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(CLOUD_SYNC_RUNTIME_DIAGNOSTIC_KEY, JSON.stringify(snapshot));
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOUD_SYNC_RUNTIME_CHANGED_EVENT));
  },
});

export function inspectCloudSyncRuntimeControllerState(): CloudSyncRuntimeControllerSnapshot {
  if (typeof sessionStorage !== "undefined") {
    const stored = sessionStorage.getItem(CLOUD_SYNC_RUNTIME_DIAGNOSTIC_KEY);
    if (stored) {
      try { return JSON.parse(stored) as CloudSyncRuntimeControllerSnapshot; }
      catch { /* Fall back to the live, read-only snapshot. */ }
    }
  }
  return automaticCloudSyncController.inspect();
}

export function retryCloudSyncThroughRuntimeController(): void {
  automaticCloudSyncController.notifyOnline();
}

export function synchronizeCloudNowThroughRuntimeController(): Promise<CloudSyncRuntimeControllerSnapshot> {
  if (manualCloudSyncOperation) return manualCloudSyncOperation;
  manualCloudSyncInProgress = true;
  const operation = (async () => {
    await automaticCloudSyncController.synchronizeNow();
    const snapshot = automaticCloudSyncController.inspect();
    if (!snapshot.scope || getRuntimeDataScope() !== snapshot.scope) throw new Error("SYNC_USER_SWITCH");
    const tracks = new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), snapshot.scope);
    const queue = new IndexedDbFlightTrackQueueStorage(snapshot.scope);
    await tracks.discoverMissingDownloadJobs(queue);
    const trackReport = await drainFlightTrackQueue({ scope: snapshot.scope, storage: queue, transport: { upload: (id) => tracks.upload(id), download: (id) => tracks.download(id), cleanup: (id) => tracks.cleanup(id) } });
    if (trackReport.failed > 0 || trackReport.stoppedForUserSwitch) throw new Error("SYNC_TRACKS_INCOMPLETE");
    return automaticCloudSyncController.inspect();
  })().finally(() => { manualCloudSyncInProgress = false; manualCloudSyncOperation = null; });
  manualCloudSyncOperation = operation;
  return operation;
}

function acquireRuntimeMount(): () => void {
  runtimeMountCount += 1;
  runtimeUnmountGeneration += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runtimeMountCount -= 1;
    const generation = ++runtimeUnmountGeneration;
    queueMicrotask(() => {
      if (runtimeMountCount === 0 && runtimeUnmountGeneration === generation) automaticCloudSyncController.setUser(null);
    });
  };
}

async function createLocalOfficialAscensionTest(scope: `USER:${string}`): Promise<Readonly<{ ascensionId: string; mutationId: string }>> {
  const state = persistManualOfficialAscension({
    dateIso: "2026-08-23",
    date: "23 août 2026",
    balloonModel: "BC-CLOUD-TEST",
    balloonManufacturer: "BALLOON COMPANION DEV",
    registration: "F-TEST",
    departure: "BC TEST DEPART",
    arrival: "BC TEST ARRIVEE",
    category: "Libre à air chaud",
    pilotFunction: "Pilote",
    nightFlight: false,
    maximumAltitudeM: 424,
    officialDurationMinutes: 42,
    flightNature: "STANDARD",
    takeoffCount: 1,
    landingCount: 1,
    observations: "BC CLOUD TARGETED TEST — LOCAL ONLY",
  });
  const ascension = state.officialAscensions.at(-1);
  if (!ascension || ascension.observations !== "BC CLOUD TARGETED TEST — LOCAL ONLY") {
    throw new Error("Ascension locale de test non créée");
  }
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).find((candidate) => candidate.entityType === "logbook-entry" && candidate.entityId === ascension.id);
    if (mutation) return { ascensionId: ascension.id, mutationId: mutation.mutationId };
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error("Mutation logbook-entry locale non persistée");
}

function latestLocalOfficialAscensionTest() {
  return [...loadFlightCompletionState().officialAscensions].reverse().find((ascension) =>
    ascension.balloonModel === "BC-CLOUD-TEST" &&
    ["BC CLOUD TARGETED TEST — LOCAL ONLY", "BC CLOUD TARGETED TEST — UPDATED"].includes(ascension.observations),
  );
}

async function waitForLocalLogbookMutation(
  scope: `USER:${string}`,
  ascensionId: string,
  operation: "UPSERT" | "DELETE",
): Promise<Readonly<{ ascensionId: string; mutationId: string }>> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).filter((candidate) =>
      candidate.entityType === "logbook-entry" && candidate.entityId === ascensionId && candidate.operation === operation,
    ).at(-1);
    if (mutation) return { ascensionId, mutationId: mutation.mutationId };
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`Mutation logbook-entry ${operation} locale non persistée`);
}

async function updateLocalOfficialAscensionTest(scope: `USER:${string}`): Promise<Readonly<{ ascensionId: string; mutationId: string }>> {
  const ascension = latestLocalOfficialAscensionTest();
  if (!ascension) throw new Error("Ascension locale de test introuvable");
  const { id, source: _source, sourceFlightId: _sourceFlightId, gpsDurationMinutes: _gpsDurationMinutes, ...input } = ascension;
  const updated = persistOfficialAscensionUpdate(id, { ...input, observations: "BC CLOUD TARGETED TEST — UPDATED" });
  if (!updated) throw new Error("Ascension locale de test non modifiée");
  return waitForLocalLogbookMutation(scope, id, "UPSERT");
}

async function deleteLocalOfficialAscensionTest(scope: `USER:${string}`): Promise<Readonly<{ ascensionId: string; mutationId: string }>> {
  const ascension = latestLocalOfficialAscensionTest();
  if (!ascension) throw new Error("Ascension locale de test introuvable");
  if (!saveFlightCompletionState(removeOfficialAscension(loadFlightCompletionState(), ascension.id))) {
    throw new Error("Ascension locale de test non supprimée");
  }
  return waitForLocalLogbookMutation(scope, ascension.id, "DELETE");
}

function latestLocalBalloonTest() {
  return [...loadBalloonRegistry().balloons].reverse().find((balloon) =>
    balloon.registration === "F-BCTT" && balloon.manufacturer === "BC CLOUD TARGETED TEST",
  );
}

async function waitForLocalBalloonMutation(
  scope: `USER:${string}`,
  balloonId: string,
  operation: "UPSERT" | "DELETE",
): Promise<Readonly<{ balloonId: string; mutationId: string }>> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).filter((candidate) =>
      candidate.entityType === "balloon" && candidate.entityId === balloonId && candidate.operation === operation,
    ).at(-1);
    if (mutation) return { balloonId, mutationId: mutation.mutationId };
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`Mutation balloon ${operation} locale non persistée`);
}

async function createLocalBalloonTest(scope: `USER:${string}`): Promise<Readonly<{ balloonId: string; mutationId: string }>> {
  if (latestLocalBalloonTest()) throw new Error("Ballon local de test déjà présent");
  const balloon = await addBalloon({
    registration: "F-BCTT",
    manufacturer: "BC CLOUD TARGETED TEST",
    model: "CREATE",
    category: "Libre à air chaud",
    volumeM3: 2600,
    applicableMtowKg: 850,
    configurationLimitsConfirmed: true,
    color: "Test local",
    weights: { fullCylinders: [] },
  });
  if (!balloon) throw new Error("Ballon local de test non créé");
  return waitForLocalBalloonMutation(scope, balloon.id, "UPSERT");
}

async function updateLocalBalloonTest(scope: `USER:${string}`): Promise<Readonly<{ balloonId: string; mutationId: string }>> {
  const balloon = latestLocalBalloonTest();
  if (!balloon) throw new Error("Ballon local de test introuvable");
  const updated = await editBalloon(balloon.id, {
    registration: balloon.registration,
    manufacturer: balloon.manufacturer,
    model: "UPDATED",
    category: balloon.category,
    volumeM3: balloon.volumeM3,
    applicableMtowKg: balloon.applicableMtowKg,
    configurationLimitsConfirmed: balloon.configurationLimitsConfirmed,
    color: "BC CLOUD TARGETED TEST — UPDATED",
    weights: balloon.weights,
  });
  if (!updated) throw new Error("Ballon local de test non modifié");
  return waitForLocalBalloonMutation(scope, balloon.id, "UPSERT");
}

async function deleteLocalBalloonTest(scope: `USER:${string}`): Promise<Readonly<{ balloonId: string; mutationId: string }>> {
  const balloon = latestLocalBalloonTest();
  if (!balloon) throw new Error("Ballon local de test introuvable");
  if (!await deleteBalloon(balloon.id)) throw new Error("Ballon local de test non supprimé");
  return waitForLocalBalloonMutation(scope, balloon.id, "DELETE");
}

async function createLocalDocumentParentBalloonTest(scope: `USER:${string}`): Promise<Readonly<{ balloonId: string; mutationId: string }>> {
  if (loadBalloonRegistry().balloons.some((balloon) => balloon.registration === "F-BCDT")) {
    throw new Error("Ballon parent local de test document déjà présent");
  }
  const balloon = await addBalloon({
    registration: "F-BCDT",
    manufacturer: "BC CLOUD TARGETED TEST",
    model: "BC DOCUMENT PARENT TEST",
    category: "Libre à air chaud",
    volumeM3: 2600,
    applicableMtowKg: 850,
    configurationLimitsConfirmed: true,
    color: "Document parent local",
    weights: { fullCylinders: [] },
  });
  if (!balloon) throw new Error("Ballon parent local de test document non créé");
  return waitForLocalBalloonMutation(scope, balloon.id, "UPSERT");
}

async function createLocalDocumentTest(scope: `USER:${string}`): Promise<Readonly<{ documentId: string; mutationId: string }>> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const pending = await outbox.list();
  const balloons = loadBalloonRegistry().balloons;
  let parentId: string | null = null;
  for (const balloon of balloons) {
    const metadata = await outbox.getMetadata("balloon", balloon.id);
    const hasPendingMutation = pending.some((mutation) => mutation.entityType === "balloon" && mutation.entityId === balloon.id);
    if (metadata && !metadata.deletedAt && !hasPendingMutation) {
      parentId = balloon.id;
      if (balloon.registration === "F-BCTT" && balloon.manufacturer === "BC CLOUD TARGETED TEST") break;
    }
  }
  if (!parentId) throw new Error("Aucun ballon local confirmé synchronisé et sans mutation en attente");

  const document = await balloonDocumentStorage.addMetadataOnlyDocumentForCloudTest({
    balloonId: parentId,
    category: "OTHER",
    title: "BC CLOUD DOCUMENT TARGETED TEST",
    notes: "BC CLOUD TARGETED TEST — METADATA ONLY",
  }, {
    originalFileName: "bc-cloud-document-test.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
  });
  const mutation = (await outbox.list()).find((candidate) =>
    candidate.entityType === "balloon-document" && candidate.entityId === document.id && candidate.operation === "UPSERT",
  );
  if (!mutation) throw new Error("Mutation balloon-document locale non persistée");
  return { documentId: document.id, mutationId: mutation.mutationId };
}

async function latestLocalDocumentTest() {
  const documents = (await Promise.all(loadBalloonRegistry().balloons.map((balloon) =>
    balloonDocumentStorage.listByBalloonId(balloon.id),
  ))).flat();
  return documents.filter((document) => [
    "BC CLOUD DOCUMENT TARGETED TEST",
    "BC CLOUD DOCUMENT TARGETED TEST — UPDATED",
  ].includes(document.title)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

async function waitForLocalDocumentMutation(
  scope: `USER:${string}`,
  documentId: string,
  operation: "UPSERT" | "DELETE",
): Promise<Readonly<{ documentId: string; mutationId: string }>> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).filter((candidate) =>
      candidate.entityType === "balloon-document" && candidate.entityId === documentId && candidate.operation === operation,
    ).at(-1);
    if (mutation) return { documentId, mutationId: mutation.mutationId };
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`Mutation balloon-document ${operation} locale non persistée`);
}

async function updateLocalDocumentTest(scope: `USER:${string}`): Promise<Readonly<{ documentId: string; mutationId: string }>> {
  const document = await latestLocalDocumentTest();
  if (!document) throw new Error("Document local de test introuvable");
  await balloonDocumentStorage.updateDocument(document.id, {
    title: "BC CLOUD DOCUMENT TARGETED TEST — UPDATED",
    notes: "BC CLOUD TARGETED TEST — METADATA UPDATED",
  });
  return waitForLocalDocumentMutation(scope, document.id, "UPSERT");
}

async function deleteLocalDocumentTest(scope: `USER:${string}`): Promise<Readonly<{ documentId: string; mutationId: string }>> {
  const document = await latestLocalDocumentTest();
  if (!document) throw new Error("Document local de test introuvable");
  await balloonDocumentStorage.deleteDocument(document.id);
  return waitForLocalDocumentMutation(scope, document.id, "DELETE");
}

async function latestLocalFlightTest() {
  return (await new IndexedDbRecordedFlightStorage().listFlights()).find((flight) =>
    flight.generatedTitle === "BC CLOUD FLIGHT TARGETED TEST",
  ) ?? null;
}

async function waitForLocalFlightMutation(
  scope: `USER:${string}`,
  flightId: string,
  operation: "UPSERT" | "DELETE",
): Promise<Readonly<{ flightId: string; mutationId: string }>> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).filter((candidate) =>
      candidate.entityType === "flight" && candidate.entityId === flightId && candidate.operation === operation,
    ).at(-1);
    if (mutation) return { flightId, mutationId: mutation.mutationId };
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`Mutation flight ${operation} locale non persistée`);
}

async function createLocalFlightTest(scope: `USER:${string}`): Promise<Readonly<{ flightId: string; mutationId: string }>> {
  if (await latestLocalFlightTest()) throw new Error("Vol local ciblé de test déjà présent");
  const startedAt = Date.now() - 42 * 60_000;
  const flight = {
    ...finalizeRecordedFlight(createRecordedFlight({ startedAt }), startedAt + 42 * 60_000),
    startLocationLabel: "BC TEST DEPART",
    endLocationLabel: "BC TEST ARRIVEE",
    generatedTitle: "BC CLOUD FLIGHT TARGETED TEST",
    notes: "BC CLOUD TARGETED TEST — LOCAL FLIGHT",
  };
  await new IndexedDbRecordedFlightStorage().completeFlight(flight);
  return waitForLocalFlightMutation(scope, flight.id, "UPSERT");
}

async function updateLocalFlightTest(scope: `USER:${string}`): Promise<Readonly<{ flightId: string; mutationId: string }>> {
  const flight = await latestLocalFlightTest();
  if (!flight) throw new Error("Vol local ciblé de test introuvable");
  const updated = await new IndexedDbRecordedFlightStorage().updateFlightNotes(
    flight.id,
    "BC CLOUD FLIGHT TARGETED TEST — UPDATED",
  );
  if (!updated) throw new Error("Vol local ciblé de test non modifié");
  return waitForLocalFlightMutation(scope, flight.id, "UPSERT");
}

async function deleteLocalFlightTest(scope: `USER:${string}`): Promise<Readonly<{ flightId: string; mutationId: string }>> {
  const flight = await latestLocalFlightTest();
  if (!flight) throw new Error("Vol local ciblé de test introuvable");
  await new IndexedDbRecordedFlightStorage().deleteFlight(flight.id);
  return waitForLocalFlightMutation(scope, flight.id, "DELETE");
}

type BatchStep = "PASS" | "FAIL" | "SKIP";
type BatchCrudReport = Readonly<{ CREATE: BatchStep; UPDATE: BatchStep; DELETE: BatchStep; reason?: string }>;

function skippedCrud(reason: string): BatchCrudReport {
  return { CREATE: "SKIP", UPDATE: "SKIP", DELETE: "SKIP", reason };
}

async function waitForOwnedMutation(
  scope: `USER:${string}`,
  entityType: string,
  entityId: string,
  operation: "UPSERT" | "DELETE",
): Promise<SyncMutation> {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mutation = (await outbox.list()).filter((candidate) =>
      candidate.entityType === entityType && candidate.entityId === entityId && candidate.operation === operation,
    ).at(-1);
    if (mutation) return mutation;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error(`Mutation ${entityType} ${operation} locale non persistée`);
}

async function runRemainingCloudTargetedTests(
  scope: `USER:${string}`,
  syncById: (mutationId: string) => Promise<CloudSyncPassResult>,
) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const oldMutations = new Map((await outbox.list()).map((mutation) => [mutation.mutationId, JSON.stringify(mutation)]));
  const ownedMutationIds = new Set<string>();

  const syncOwned = async (mutation: SyncMutation, expectedRevision: number): Promise<void> => {
    ownedMutationIds.add(mutation.mutationId);
    if (!ownedMutationIds.has(mutation.mutationId) || oldMutations.has(mutation.mutationId)) throw new Error("Mutation non créée par ce batch");
    const result = await syncById(mutation.mutationId);
    if (result.state !== "COMPLETED" || result.applied !== 1 || result.conflicts !== 0 || result.notFound !== 0 || result.ignored !== 0) {
      throw new Error(`Résultat ciblé inattendu: ${JSON.stringify(result)}`);
    }
    const metadata = await outbox.getMetadata(mutation.entityType, mutation.entityId);
    if (metadata?.revision !== expectedRevision) throw new Error(`Révision attendue ${expectedRevision}, reçue ${metadata?.revision ?? "absente"}`);
    if (mutation.operation === "DELETE" && !metadata.deletedAt) throw new Error("Tombstone local de confirmation absent");
  };

  const runDomain = async (steps: readonly [() => Promise<void>, () => Promise<void>, () => Promise<void>]): Promise<BatchCrudReport> => {
    const report: { CREATE: BatchStep; UPDATE: BatchStep; DELETE: BatchStep; reason?: string } = { CREATE: "SKIP", UPDATE: "SKIP", DELETE: "SKIP" };
    for (const [index, name] of (["CREATE", "UPDATE", "DELETE"] as const).entries()) {
      try { await steps[index]!(); report[name] = "PASS"; }
      catch (error) { report[name] = "FAIL"; report.reason = error instanceof Error ? error.message : String(error); break; }
    }
    return report;
  };

  let flightId = "";
  const flight = await runDomain([
    async () => { const created = await createLocalFlightTest(scope); flightId = created.flightId; await syncOwned((await outbox.list()).find(({ mutationId }) => mutationId === created.mutationId)!, 0); },
    async () => { const updated = await updateLocalFlightTest(scope); if (updated.flightId !== flightId) throw new Error("Vol UPDATE différent du CREATE"); await syncOwned((await outbox.list()).find(({ mutationId }) => mutationId === updated.mutationId)!, 1); },
    async () => { const deleted = await deleteLocalFlightTest(scope); if (deleted.flightId !== flightId) throw new Error("Vol DELETE différent du CREATE"); await syncOwned((await outbox.list()).find(({ mutationId }) => mutationId === deleted.mutationId)!, 2); },
  ]);

  const weatherEntityId = `bc-cloud-weather-${crypto.randomUUID()}`;
  let weatherFavoriteId = "";
  const favoriteWeatherPlace = await runDomain([
    async () => {
      const existing = loadFavoriteWeatherPlaces();
      let latitude = -70.1234;
      while (existing.some((favorite) => Math.abs(favorite.latitude - latitude) < 0.000001 && Math.abs(favorite.longitude + 140.1234) < 0.000001)) latitude += 0.01;
      const added = addOrReuseFavoriteWeatherPlace(existing, { id: weatherEntityId, name: "BC CLOUD WEATHER TARGETED TEST", latitude, longitude: -140.1234 });
      weatherFavoriteId = added.selected.id;
      if (!await saveFavoriteWeatherPlacesWithDurableOutbox(added.favorites)) throw new Error("Favori météo test non créé");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-weather-place", weatherFavoriteId, "UPSERT"), 0);
    },
    async () => {
      const updated = renameFavoriteWeatherPlace(loadFavoriteWeatherPlaces(), weatherFavoriteId, "BC CLOUD WEATHER TARGETED TEST — UPDATED");
      if (!await saveFavoriteWeatherPlacesWithDurableOutbox(updated)) throw new Error("Favori météo test non modifié");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-weather-place", weatherFavoriteId, "UPSERT"), 1);
    },
    async () => {
      if (!await saveFavoriteWeatherPlacesWithDurableOutbox(removeFavoriteWeatherPlace(loadFavoriteWeatherPlaces(), weatherFavoriteId))) throw new Error("Favori météo test non supprimé");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-weather-place", weatherFavoriteId, "DELETE"), 2);
    },
  ]);

  const launchEntityId = `bc-cloud-launch-${crypto.randomUUID()}`;
  let launchFavoriteId = "";
  const favoriteLaunchSite = await runDomain([
    async () => {
      const existing = loadFavoriteLaunchSites();
      let latitude = -69.2345;
      while (existing.some((favorite) => favorite.latitude.toFixed(6) === latitude.toFixed(6) && favorite.longitude.toFixed(6) === "-139.234500")) latitude += 0.01;
      const added = addOrReuseFavoriteLaunchSite(existing, { id: launchEntityId, name: "BC CLOUD LAUNCH TARGETED TEST", latitude, longitude: -139.2345 });
      launchFavoriteId = added.selected.id;
      if (!saveFavoriteLaunchSites(added.favorites)) throw new Error("Terrain favori test non créé");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-launch-site", launchFavoriteId, "UPSERT"), 0);
    },
    async () => {
      if (!saveFavoriteLaunchSites(renameFavoriteLaunchSite(loadFavoriteLaunchSites(), launchFavoriteId, "BC CLOUD LAUNCH TARGETED TEST — UPDATED"))) throw new Error("Terrain favori test non modifié");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-launch-site", launchFavoriteId, "UPSERT"), 1);
    },
    async () => {
      const current = loadFavoriteLaunchSites();
      const target = current.find(({ id }) => id === launchFavoriteId);
      if (!target || !saveFavoriteLaunchSites(removeFavoriteLaunchSite(current, target))) throw new Error("Terrain favori test non supprimé");
      await syncOwned(await waitForOwnedMutation(scope, "favorite-launch-site", launchFavoriteId, "DELETE"), 2);
    },
  ]);

  const remaining = await outbox.list();
  const oldMutationsTouched = [...oldMutations].filter(([mutationId, serialized]) =>
    JSON.stringify(remaining.find((mutation) => mutation.mutationId === mutationId)) !== serialized,
  ).length;
  const report = {
    flight,
    favorite_weather_place: favoriteWeatherPlace,
    favorite_launch_site: favoriteLaunchSite,
    profile: { status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" },
    user_preferences: { status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" },
    aviation_preferences: { status: "SKIP", reason: "SKIPPED_REAL_USER_DATA" },
    oldMutationsTouched,
    globalDrain: false,
    R2: false,
    blob: false,
    cloudGpsTrace: false,
  } as const;
  const summary = [
    "CLOUD TARGETED BATCH TEST",
    `flight: CREATE ${flight.CREATE} / UPDATE ${flight.UPDATE} / DELETE ${flight.DELETE}`,
    `favorite_weather_place: CREATE ${favoriteWeatherPlace.CREATE} / UPDATE ${favoriteWeatherPlace.UPDATE} / DELETE ${favoriteWeatherPlace.DELETE}`,
    `favorite_launch_site: CREATE ${favoriteLaunchSite.CREATE} / UPDATE ${favoriteLaunchSite.UPDATE} / DELETE ${favoriteLaunchSite.DELETE}`,
    "profile: SKIP — SKIPPED_REAL_USER_DATA",
    "user_preferences: SKIP — SKIPPED_REAL_USER_DATA",
    "aviation_preferences: SKIP — SKIPPED_REAL_USER_DATA",
    `Anciennes mutations touchées: ${oldMutationsTouched}`,
    "Drain global: NON",
    "R2: NON",
    "Blob: NON",
    "Trace GPS Cloud: NON",
  ].join("\n");
  console.info(summary);
  return { ...report, summary };
}

type ProtectedDomainReport = Readonly<{
  TEST_UPDATE: BatchStep;
  RESTORE: BatchStep;
  RESTORED_EXACTLY: "OUI" | "NON" | "SKIP";
  reason?: string;
}>;

async function runProtectedUserDataCloudTargetedTests(
  scope: `USER:${string}`,
  syncById: (mutationId: string) => Promise<CloudSyncPassResult>,
) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const oldMutations = new Map((await outbox.list()).map((mutation) => [mutation.mutationId, JSON.stringify(mutation)]));

  const runProtectedDomain = async <T,>(input: Readonly<{
    entityType: "unit-preferences" | "weather-preferences" | "aviation-preferences";
    entityId: "singleton";
    load(): T | null;
    save(value: T): unknown;
    temporary(snapshot: T): T;
  }>): Promise<ProtectedDomainReport> => {
    if ((await outbox.list()).some((mutation) => mutation.entityType === input.entityType && mutation.entityId === input.entityId)) {
      return { TEST_UPDATE: "SKIP", RESTORE: "SKIP", RESTORED_EXACTLY: "SKIP", reason: "PREEXISTING_MUTATION" };
    }
    const loaded = input.load();
    if (loaded === null) return { TEST_UPDATE: "SKIP", RESTORE: "SKIP", RESTORED_EXACTLY: "SKIP", reason: "UNINITIALIZED_LOCAL_STATE" };
    const snapshot = structuredClone(loaded);
    const snapshotSerialized = JSON.stringify(snapshot);
    let testStatus: BatchStep = "FAIL";
    let restoreStatus: BatchStep = "FAIL";
    let reason: string | undefined;

    const syncNewMutation = async (): Promise<void> => {
      const mutation = await waitForOwnedMutation(scope, input.entityType, input.entityId, "UPSERT");
      if (oldMutations.has(mutation.mutationId) || mutation.entityType !== input.entityType || mutation.entityId !== input.entityId || mutation.operation !== "UPSERT") {
        throw new Error("Mutation protégée non créée par ce test");
      }
      const result = await syncById(mutation.mutationId);
      if (result.state !== "COMPLETED" || result.applied !== 1 || result.conflicts !== 0 || result.notFound !== 0 || result.ignored !== 0) {
        throw new Error(`Résultat ciblé inattendu: ${JSON.stringify(result)}`);
      }
      const afterMetadata = await outbox.getMetadata(input.entityType, input.entityId);
      const expectedRevisions = mutation.baseRevision === 0 ? [0, 1] : [mutation.baseRevision + 1];
      if (afterMetadata?.revision === undefined || !expectedRevisions.includes(afterMetadata.revision)) {
        throw new Error(`Révision attendue ${expectedRevisions.join(" ou ")}, reçue ${afterMetadata?.revision ?? "absente"}`);
      }
    };

    try {
      input.save(input.temporary(structuredClone(snapshot)));
      await syncNewMutation();
      testStatus = "PASS";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }

    try {
      input.save(structuredClone(snapshot));
      await syncNewMutation();
      restoreStatus = "PASS";
    } catch (error) {
      reason = `${reason ? `${reason}; ` : ""}RESTORE: ${error instanceof Error ? error.message : String(error)}`;
    }
    const restoredExactly = JSON.stringify(input.load()) === snapshotSerialized;
    return {
      TEST_UPDATE: testStatus,
      RESTORE: restoreStatus,
      RESTORED_EXACTLY: restoredExactly ? "OUI" : "NON",
      ...(!restoredExactly ? { reason: `${reason ? `${reason}; ` : ""}FAIL_RESTORE` } : reason ? { reason } : {}),
    };
  };

  const profile: ProtectedDomainReport = {
    TEST_UPDATE: "SKIP", RESTORE: "SKIP", RESTORED_EXACTLY: "SKIP",
    reason: "NO_SAFE_NON_CRITICAL_FIELD",
  };
  const unitPreferences = await runProtectedDomain({
    entityType: "unit-preferences",
    entityId: "singleton",
    load: loadUnitPreferences,
    save: saveUnitPreferences,
    temporary: (snapshot) => ({
      ...snapshot,
      flightInstruments: {
        ...snapshot.flightInstruments,
        distanceUnit: (snapshot.flightInstruments.distanceUnit === "km" ? "NM" : "km") as "NM" | "km",
      },
    }),
  });
  const weatherPreferences = await runProtectedDomain({
    entityType: "weather-preferences",
    entityId: "singleton",
    load: loadWeatherPreferences,
    save: saveWeatherPreferences,
    temporary: (snapshot) => ({
      ...snapshot,
      weatherModel: snapshot.weatherModel === "arome_seamless" ? "icon_seamless" : "arome_seamless",
    }),
  });
  const aviationPreferences = await runProtectedDomain({
    entityType: "aviation-preferences",
    entityId: "singleton",
    load: loadAviationPreferences,
    save: (value) => saveAviationPreferences(value.airportIcao, value.favorites),
    temporary: (snapshot) => {
      const testIcao = ["ZZZZ", "ZZZY", "ZZZX"].find((icao) => !snapshot.favorites.some((favorite) => favorite.icao === icao));
      if (!testIcao) throw new Error("Aucun ICAO de test isolé disponible");
      return { ...snapshot, favorites: [...snapshot.favorites, { icao: testIcao, name: "BC CLOUD AVIATION TARGETED TEST" }] };
    },
  });

  const remaining = await outbox.list();
  const oldMutationsTouched = [...oldMutations].filter(([mutationId, serialized]) =>
    JSON.stringify(remaining.find((mutation) => mutation.mutationId === mutationId)) !== serialized,
  ).length;
  const summary = [
    "PROTECTED USER DATA CLOUD TEST",
    `profile: TEST UPDATE ${profile.TEST_UPDATE} / RESTORE ${profile.RESTORE} / RESTORED EXACTLY ${profile.RESTORED_EXACTLY}`,
    `unit_preferences: TEST UPDATE ${unitPreferences.TEST_UPDATE} / RESTORE ${unitPreferences.RESTORE} / RESTORED EXACTLY ${unitPreferences.RESTORED_EXACTLY}`,
    `weather_preferences: TEST UPDATE ${weatherPreferences.TEST_UPDATE} / RESTORE ${weatherPreferences.RESTORE} / RESTORED EXACTLY ${weatherPreferences.RESTORED_EXACTLY}`,
    `aviation_preferences: TEST UPDATE ${aviationPreferences.TEST_UPDATE} / RESTORE ${aviationPreferences.RESTORE} / RESTORED EXACTLY ${aviationPreferences.RESTORED_EXACTLY}`,
    `Anciennes mutations touchées: ${oldMutationsTouched}`,
    "Drain global: NON",
    "R2: NON",
    "Blob: NON",
    "Auth: NON MODIFIÉE",
  ].join("\n");
  console.info(summary);
  return {
    profile,
    unit_preferences: unitPreferences,
    weather_preferences: weatherPreferences,
    aviation_preferences: aviationPreferences,
    oldMutationsTouched,
    globalDrain: false,
    R2: false,
    blob: false,
    authModified: false,
    summary,
  } as const;
}

async function auditProtectedPreferenceMutations(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const payloads = new BrowserCloudSyncPayloadProvider(window.localStorage, scope);
  const allowedTypes = ["weather-preferences", "aviation-preferences"] as const;
  const mutations = (await outbox.list()).filter((mutation) =>
    allowedTypes.includes(mutation.entityType as typeof allowedTypes[number]),
  );

  const auditDomain = async (entityType: typeof allowedTypes[number]) => {
    const candidates = mutations.filter((mutation) => mutation.entityType === entityType);
    const inspected = await Promise.all(candidates.map(async (mutation) => {
      const currentPayload = await payloads.build(mutation);
      return {
        mutationId: mutation.mutationId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        operation: mutation.operation,
        baseRevision: mutation.baseRevision,
        createdAt: mutation.createdAt,
        attempts: mutation.attempts,
        ...(mutation.lastErrorCode ? { lastErrorCode: mutation.lastErrorCode } : {}),
        payloadSummary: currentPayload ? {
          serverEntityType: currentPayload.serverEntityType,
          serverEntityId: currentPayload.serverEntityId,
          payload: currentPayload.payload,
          source: "CURRENT_LOCAL_STATE_AT_AUDIT",
        } : null,
        multipleForEntityType: candidates.length > 1,
      };
    }));
    const latest = candidates.at(-1);
    return {
      count: candidates.length,
      mutations: inspected,
      latestMatchesCurrentLocalState: !latest ? "INCERTAIN" : latest.operation === "UPSERT" && inspected.at(-1)?.payloadSummary ? "OUI" : "NON",
    } as const;
  };

  return {
    weather_preferences: await auditDomain("weather-preferences"),
    aviation_preferences: await auditDomain("aviation-preferences"),
  } as const;
}

async function inspectProtectedPreferenceConflictState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const payloads = new BrowserCloudSyncPayloadProvider(window.localStorage, scope);
  const issues = await new BrowserCloudSyncIssueRepository(window.localStorage, scope).list();
  const client = createBrowserSupabaseClient();
  const definitions = [
    { localEntityType: "weather-preferences", localEntityId: "singleton", table: "user_preferences", cloudEntityId: "weather" },
    { localEntityType: "aviation-preferences", localEntityId: "singleton", table: "aviation_preferences", cloudEntityId: "aviation" },
  ] as const;
  const allMutations = await outbox.list();

  const inspected = await Promise.all(definitions.map(async (definition) => {
    const mutations = allMutations.filter((mutation) =>
      mutation.entityType === definition.localEntityType && mutation.entityId === definition.localEntityId,
    );
    const { data, error } = await client
      .from(definition.table)
      .select("id,revision,updated_at,deleted_at")
      .eq("id", definition.cloudEntityId)
      .maybeSingle();
    return [definition.localEntityType, {
      localEntityId: definition.localEntityId,
      localSidecar: await outbox.getMetadata(definition.localEntityType, definition.localEntityId),
      mutations: await Promise.all(mutations.map(async (mutation) => ({
        mutation,
        currentPayload: await payloads.build(mutation),
        conflictIssue: issues.find((issue) =>
          issue.kind === "CONFLICT" && issue.entityType === mutation.entityType && issue.entityId === mutation.entityId,
        ) ?? null,
        eligibleForCoalescing: mutation.attempts === 0,
      }))),
      cloudState: error ? { status: "READ_ERROR", code: error.code ?? null } : { status: "READ_OK", row: data },
    }] as const;
  }));

  return Object.fromEntries(inspected);
}

async function auditCloudSyncFinalState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const payloads = new BrowserCloudSyncPayloadProvider(window.localStorage, scope);
  const mutations = await outbox.list();
  const sidecars = await outbox.listMetadata();
  const domainDefinitions = [
    { reportKey: "balloon", localTypes: ["balloon"] },
    { reportKey: "flight", localTypes: ["flight"] },
    { reportKey: "logbook_entry", localTypes: ["logbook-entry"] },
    { reportKey: "document", localTypes: ["balloon-document"] },
    { reportKey: "favorite_weather_place", localTypes: ["favorite-weather-place"] },
    { reportKey: "favorite_launch_site", localTypes: ["favorite-launch-site"] },
    { reportKey: "unit_preferences", localTypes: ["unit-preferences"] },
    { reportKey: "weather_preferences", localTypes: ["weather-preferences"], expectedMinimumRevision: 2 },
    { reportKey: "aviation_preferences", localTypes: ["aviation-preferences"], expectedMinimumRevision: 2 },
    { reportKey: "profile", localTypes: ["pilot-profile"] },
  ] as const;
  const inspectedMutations = await Promise.all(mutations.map(async (mutation) => {
    const currentPayload = await payloads.build(mutation);
    const serializedPayload = JSON.stringify(currentPayload?.payload ?? {});
    const localOnly = isLegacyLocalOnlyMutation(mutation);
    return {
      mutationId: mutation.mutationId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operation: mutation.operation,
      baseRevision: mutation.baseRevision,
      createdAt: mutation.createdAt,
      attempts: mutation.attempts,
      lastErrorCode: mutation.lastErrorCode ?? null,
      localOnly,
      conflict: !localOnly && mutation.lastErrorCode === "CONFLICT",
      orphan: !localOnly && mutation.operation === "UPSERT" && currentPayload === null,
      testResidual: !localOnly && /BC CLOUD|TARGETED TEST/i.test(serializedPayload),
      sidecarRevision: sidecars.find((metadata) => metadata.entityType === mutation.entityType && metadata.entityId === mutation.entityId)?.revision ?? null,
    };
  }));

  const domains = Object.fromEntries(domainDefinitions.map((definition) => {
    const domainMutations = inspectedMutations.filter((mutation) => definition.localTypes.some((type) => type === mutation.entityType));
    const domainSidecars = sidecars.filter((metadata) => definition.localTypes.some((type) => type === metadata.entityType));
    const singletonMultiplicity = definition.localTypes.some((type) => ["unit-preferences", "weather-preferences", "aviation-preferences", "pilot-profile"].includes(type))
      && domainMutations.length > 1;
    const staleKnownSidecars = "expectedMinimumRevision" in definition
      ? domainSidecars.filter((metadata) => metadata.revision < definition.expectedMinimumRevision)
      : [];
    return [definition.reportKey, {
      mutationCount: domainMutations.length,
      mutations: domainMutations,
      sidecars: domainSidecars,
      singletonMultiplicity,
      staleKnownSidecars,
    }];
  }));
  const staleKnownSidecars = Object.values(domains).flatMap((domain) => domain.staleKnownSidecars);
  const unjustifiedSingletonMultiples = Object.values(domains).filter((domain) => domain.singletonMultiplicity).length;
  const { localOnlyMutations, conflicts, attemptedMutations, orphanMutations, testResiduals, overall } = classifyFinalAuditMutations(
    inspectedMutations,
    staleKnownSidecars.length > 0 || unjustifiedSingletonMultiples > 0,
  );
  const summary = [
    "CLOUD SYNC FINAL AUDIT",
    `outboxTotal: ${mutations.length}`,
    `conflicts: ${conflicts.length}`,
    `attemptedMutations: ${attemptedMutations.length}`,
    `orphanMutations: ${orphanMutations.length}`,
    `testResiduals: ${testResiduals.length}`,
    `localOnlyMutations: ${localOnlyMutations.length}`,
    `staleKnownSidecars: ${staleKnownSidecars.length}`,
    `unjustifiedSingletonMultiples: ${unjustifiedSingletonMultiples}`,
    `overall: ${overall}`,
  ].join("\n");
  console.info(summary);
  return {
    outboxTotal: mutations.length,
    conflicts,
    attemptedMutations,
    orphanMutations,
    testResiduals,
    localOnlyMutations,
    staleKnownSidecars,
    unjustifiedSingletonMultiples,
    domains,
    overall,
    summary,
  } as const;
}

const FAVORITE_WEATHER_PULL_TEST_ID = "bc-pull-targeted-test-20260823-v1";

async function inspectFavoriteWeatherPullTestState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const favorite = loadFavoriteWeatherPlaces().find(({ id }) => id === FAVORITE_WEATHER_PULL_TEST_ID) ?? null;
  return {
    scope,
    testId: FAVORITE_WEATHER_PULL_TEST_ID,
    localFavoriteCount: loadFavoriteWeatherPlaces().length,
    localFavorite: favorite,
    targetMutations: mutations.filter(({ entityType, entityId }) => entityType === FAVORITE_WEATHER_PLACE_PULL_DOMAIN && entityId === FAVORITE_WEATHER_PULL_TEST_ID),
    outboxTotal: mutations.length,
    sidecar: await outbox.getMetadata(FAVORITE_WEATHER_PLACE_PULL_DOMAIN, FAVORITE_WEATHER_PULL_TEST_ID),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, FAVORITE_WEATHER_PLACE_PULL_DOMAIN),
  } as const;
}

async function pullFavoriteWeatherPlacesTargetedWithVerification(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const before = await outbox.list();
  let enqueueEvents = 0;
  const countEnqueue = () => { enqueueEvents += 1; };
  window.addEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  try {
    const report = await createBrowserFavoriteWeatherPlacePullService({
      client: createBrowserSupabaseClient(),
      storage: window.localStorage,
      scope,
    }).pullFavoriteWeatherPlaces();
    const after = await outbox.list();
    return {
      ...report,
      controlledVerification: {
        enqueueEvents,
        outboxBefore: before.length,
        outboxAfter: after.length,
        targetMutationsAfter: after.filter(({ entityType, entityId }) => entityType === FAVORITE_WEATHER_PLACE_PULL_DOMAIN && entityId === FAVORITE_WEATHER_PULL_TEST_ID).length,
      },
    } as const;
  } finally {
    window.removeEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  }
}

async function inspectFavoriteLaunchSitePullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const favorites = loadFavoriteLaunchSites();
  return {
    scope,
    localCount: favorites.length,
    localFavorites: favorites.map(({ id, name }) => ({ id, name })),
    sidecars: (await outbox.listMetadata()).filter(({ entityType }) => entityType === FAVORITE_LAUNCH_SITE_PULL_DOMAIN),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, FAVORITE_LAUNCH_SITE_PULL_DOMAIN),
    pendingMutations: mutations.filter(({ entityType }) => entityType === FAVORITE_LAUNCH_SITE_PULL_DOMAIN),
  } as const;
}

async function pullFavoriteLaunchSitesTargetedWithVerification(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const before = await outbox.list();
  let enqueueEvents = 0;
  const countEnqueue = () => { enqueueEvents += 1; };
  window.addEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  try {
    const report = await createBrowserFavoriteLaunchSitePullService({
      client: createBrowserSupabaseClient(), storage: window.localStorage, scope,
    }).pullFavoriteLaunchSites();
    const after = await outbox.list();
    return { ...report, controlledVerification: { enqueueEvents, outboxBefore: before.length, outboxAfter: after.length } } as const;
  } finally {
    window.removeEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  }
}

async function inspectPilotProfilePullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  return {
    scope,
    localProfile: loadPilotProfile(),
    localOpeningBalance: loadFlightCompletionState().openingBalance,
    sidecar: await outbox.getMetadata("pilot-profile", "singleton"),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, "pilot-profile"),
    pendingMutations: mutations.filter(({ entityType, entityId }) => entityType === "pilot-profile" && entityId === "singleton"),
  } as const;
}

async function pullPilotProfileTargetedWithVerification(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const before = await outbox.list();
  let enqueueEvents = 0;
  const countEnqueue = () => { enqueueEvents += 1; };
  window.addEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  try {
    const report = await createBrowserPilotProfilePullService({
      client: createBrowserSupabaseClient(), storage: window.localStorage, scope,
    }).pullPilotProfile();
    const after = await outbox.list();
    return { ...report, controlledVerification: { enqueueEvents, outboxBefore: before.length, outboxAfter: after.length } } as const;
  } finally {
    window.removeEventListener(SYNC_MUTATION_ENQUEUED_EVENT, countEnqueue);
  }
}

async function inspectPreferencePullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const cursors = new BrowserCloudPullCursorRepository(window.localStorage);
  const definitions = [
    { domain: "unit-preferences" as const, local: loadUnitPreferences() },
    { domain: "weather-preferences" as const, local: loadWeatherPreferences() },
    { domain: "aviation-preferences" as const, local: loadAviationPreferences() },
  ];
  return {
    scope,
    domains: Object.fromEntries(await Promise.all(definitions.map(async ({ domain, local }) => {
      const pending = mutations.filter(({ entityType, entityId }) => entityType === domain && entityId === "singleton");
      return [domain, {
        local,
        sidecar: await outbox.getMetadata(domain, "singleton"),
        cursor: await cursors.get(scope, domain),
        mutations: pending,
        hasPending: pending.length > 0,
      }] as const;
    }))),
  } as const;
}

async function inspectBalloonPullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const registry = loadBalloonRegistry();
  return {
    scope,
    localBalloonCount: registry.balloons.length,
    localBalloons: registry.balloons.map(({ id, registration, model }) => ({ id, registration, model })),
    sidecars: (await outbox.listMetadata()).filter(({ entityType }) => entityType === "balloon"),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, "balloon"),
    pendingMutations: mutations.filter(({ entityType }) => entityType === "balloon"),
  } as const;
}

async function inspectFlightPullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const flights = await new IndexedDbRecordedFlightStorage().listFlights();
  const journal = loadFlightCompletionState();
  return {
    scope,
    localFlightCount: flights.length,
    localFlights: flights.map(({ id, generatedTitle, points }) => ({ id, title: generatedTitle ?? null, hasLocalTrace: points.length > 0 })),
    journalFlights: journal.journalFlights.map(({ id, sourceFlightId, generatedTitle, customTitle }) => ({ id, sourceFlightId: sourceFlightId ?? id, title: customTitle ?? generatedTitle ?? null })),
    sidecars: (await outbox.listMetadata()).filter(({ entityType }) => entityType === "flight"),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, "flight"),
    pendingMutations: mutations.filter(({ entityType }) => entityType === "flight"),
  } as const;
}

async function inspectLogbookEntryPullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const ascensions = loadFlightCompletionState().officialAscensions;
  return {
    scope,
    localOfficialAscensionCount: ascensions.length,
    localOfficialAscensions: ascensions.map(({ id, sourceFlightId, registration, dateIso }) => ({ id, sourceFlightId, registration, dateIso })),
    sidecars: (await outbox.listMetadata()).filter(({ entityType }) => entityType === "logbook-entry"),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, "logbook-entry"),
    pendingMutations: mutations.filter(({ entityType }) => entityType === "logbook-entry"),
  } as const;
}

async function inspectFlightLogbookAutoPushTestState(scope: `USER:${string}`) {
  const marker = "BC AUTO CLOUD TEST";
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const [mutations, metadata, recordedFlights] = await Promise.all([
    outbox.list(),
    outbox.listMetadata(),
    new IndexedDbRecordedFlightStorage().listFlights(),
  ]);
  const completion = loadFlightCompletionState();
  const journalFlights = completion.journalFlights.filter((flight) =>
    flight.customTitle?.includes(marker) || flight.departure.includes(marker) || flight.arrival.includes(marker),
  );
  const flightIds = new Set(journalFlights.map(({ sourceFlightId, id }) => sourceFlightId ?? id));
  const ascensions = completion.officialAscensions.filter((ascension) =>
    ascension.observations.includes(marker) || ascension.sourceFlightId !== null && flightIds.has(ascension.sourceFlightId),
  );
  const ascensionIds = new Set(ascensions.map(({ id }) => id));
  return {
    scope,
    flights: journalFlights.map((flight) => {
      const flightId = flight.sourceFlightId ?? flight.id;
      const recorded = recordedFlights.find(({ id }) => id === flightId);
      return { flightId, customTitle: flight.customTitle, departure: flight.departure, arrival: flight.arrival, localPointCount: recorded?.points.length ?? 0 };
    }),
    logbookEntries: ascensions.map(({ id, sourceFlightId, observations }) => ({ id, sourceFlightId, observations })),
    sidecars: metadata.filter(({ entityType, entityId }) =>
      entityType === "flight" && flightIds.has(entityId) || entityType === "logbook-entry" && ascensionIds.has(entityId),
    ),
    pendingMutations: mutations.filter(({ entityType, entityId }) =>
      entityType === "flight" && flightIds.has(entityId) || entityType === "logbook-entry" && ascensionIds.has(entityId),
    ),
  } as const;
}

async function inspectDocumentPullState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const documents = await balloonDocumentStorage.listDocuments();
  return {
    scope,
    localDocumentCount: documents.length,
    localDocuments: await Promise.all(documents.map(async ({ id, balloonId, title }) => ({ id, balloonId, title, hasLocalBlob: await balloonDocumentStorage.hasLocalBlob(id) }))),
    sidecars: (await outbox.listMetadata()).filter(({ entityType }) => entityType === "balloon-document"),
    cursor: await new BrowserCloudPullCursorRepository(window.localStorage).get(scope, "balloon-document"),
    pendingMutations: mutations.filter(({ entityType }) => entityType === "balloon-document"),
  } as const;
}

const BOOTSTRAP_CURSOR_DOMAINS = [
  "pilot-profile",
  "unit-preferences",
  "weather-preferences",
  "aviation-preferences",
  "favorite-weather-place",
  "favorite-launch-site",
  "balloon",
  "flight",
  "logbook-entry",
  "balloon-document",
] as const;

async function inspectCloudBootstrapState(scope: `USER:${string}`) {
  const outbox = new IndexedDbSyncOutboxStorage(scope);
  const mutations = await outbox.list();
  const cursors = new BrowserCloudPullCursorRepository(window.localStorage);
  const [flights, documents] = await Promise.all([
    new IndexedDbRecordedFlightStorage().listFlights(),
    balloonDocumentStorage.listDocuments(),
  ]);
  return {
    scope,
    domainOrder: CLOUD_BOOTSTRAP_DOMAIN_ORDER,
    cursors: Object.fromEntries(await Promise.all(BOOTSTRAP_CURSOR_DOMAINS.map(async (domain) => [domain, await cursors.get(scope, domain)] as const))),
    outboxCount: mutations.length,
    pendingByDomain: Object.fromEntries(BOOTSTRAP_CURSOR_DOMAINS.map((domain) => [domain, mutations.filter(({ entityType }) => entityType === domain).length])),
    local: {
      profile: loadPilotProfile(),
      unitPreferences: Boolean(loadUnitPreferences()),
      weatherPreferences: Boolean(loadWeatherPreferences()),
      aviationPreferences: Boolean(loadAviationPreferences()),
      favoriteWeatherPlaces: loadFavoriteWeatherPlaces().length,
      favoriteLaunchSites: loadFavoriteLaunchSites().length,
      balloons: loadBalloonRegistry().balloons.length,
      flights: flights.length,
      logbookEntries: loadFlightCompletionState().officialAscensions.length,
      documents: documents.length,
    },
    lastReport: lastCloudBootstrapReports.get(scope) ?? null,
  } as const;
}

export default function CloudSyncRuntime(): null {
  const auth = useBalloonAuth();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();

  useEffect(() => {
    const releaseRuntimeMount = acquireRuntimeMount();
    const controlled = controlledTestMode(currentSearch ? `?${currentSearch}` : "");
    const unavailableControlledApi = controlled
      ? createScopeUnavailableControlledApi<NonNullable<Window["__BC_CLOUD_SYNC_CONTROLLED_TEST__"]>>()
      : null;
    if (unavailableControlledApi) window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ = unavailableControlledApi;
    const releaseBeforeScope = () => {
      if (unavailableControlledApi && window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ === unavailableControlledApi) delete window.__BC_CLOUD_SYNC_CONTROLLED_TEST__;
      releaseRuntimeMount();
    };
    if (auth.state !== "SIGNED_IN" || !auth.user) {
      automaticCloudSyncController.setUser(null);
      return releaseBeforeScope;
    }
    if (auth.localDataMigrationState !== "MIGRATION_COMPLETE" || auth.localDataMigrationCollisions.length > 0) {
      automaticCloudSyncController.setUser(null);
      return releaseBeforeScope;
    }
    const userId = auth.user.id;
    const scope = `USER:${userId}` as const;
    if (controlled) {
      suppressRuntimeDiagnosticPersistence = true;
      automaticCloudSyncController.setUser(null);
      suppressRuntimeDiagnosticPersistence = false;
    } else automaticCloudSyncController.setUser(userId);
    const syncTargetedMutationById = (mutationId: string) => createBrowserCloudSyncService({
      client: createBrowserSupabaseClient(),
      storage: window.localStorage,
      scope,
      getScope: getRuntimeDataScope,
    }).syncMutationById(mutationId);
    const resolveProtectedConflict = (entityType: string) => {
      const outbox = new IndexedDbSyncOutboxStorage(scope);
      const payloads = new BrowserCloudSyncPayloadProvider(window.localStorage, scope);
      const client = createBrowserSupabaseClient();
      return resolveProtectedPreferenceConflictLocalWins(entityType, {
        outbox,
        getScope: getRuntimeDataScope,
        buildPayload: (mutation) => payloads.build(mutation),
        syncMutationById: syncTargetedMutationById,
        readCloudState: async (type: ProtectedPreferenceRebaseType) => {
          const target = type === "aviation-preferences"
            ? { table: "aviation_preferences" as const, id: "aviation" }
            : { table: "user_preferences" as const, id: type === "weather-preferences" ? "weather" : "units" };
          const { data, error } = await client.from(target.table)
            .select("revision,updated_at,deleted_at")
            .eq("id", target.id)
            .maybeSingle();
          if (error) throw new Error(`Cloud read failed: ${error.code ?? "UNKNOWN"}`);
          return data ? { revision: data.revision, updatedAt: data.updated_at, deletedAt: data.deleted_at } : null;
        },
      });
    };
    const controlledApi = controlled ? {
      syncMutationById: syncTargetedMutationById,
      createLocalOfficialAscensionTest: () => createLocalOfficialAscensionTest(scope),
      updateLocalOfficialAscensionTest: () => updateLocalOfficialAscensionTest(scope),
      deleteLocalOfficialAscensionTest: () => deleteLocalOfficialAscensionTest(scope),
      createLocalBalloonTest: () => createLocalBalloonTest(scope),
      updateLocalBalloonTest: () => updateLocalBalloonTest(scope),
      deleteLocalBalloonTest: () => deleteLocalBalloonTest(scope),
      createLocalDocumentParentBalloonTest: () => createLocalDocumentParentBalloonTest(scope),
      createLocalDocumentTest: () => createLocalDocumentTest(scope),
      updateLocalDocumentTest: () => updateLocalDocumentTest(scope),
      deleteLocalDocumentTest: () => deleteLocalDocumentTest(scope),
      createLocalFlightTest: () => createLocalFlightTest(scope),
      updateLocalFlightTest: () => updateLocalFlightTest(scope),
      deleteLocalFlightTest: () => deleteLocalFlightTest(scope),
      runRemainingCloudTargetedTests: () => runRemainingCloudTargetedTests(scope, syncTargetedMutationById),
      runProtectedUserDataCloudTargetedTests: () => runProtectedUserDataCloudTargetedTests(scope, syncTargetedMutationById),
      auditProtectedPreferenceMutations: () => auditProtectedPreferenceMutations(scope),
      inspectProtectedPreferenceConflictState: () => inspectProtectedPreferenceConflictState(scope),
      resolveProtectedPreferenceConflictLocalWins: resolveProtectedConflict,
      auditCloudSyncFinalState: () => auditCloudSyncFinalState(scope),
      pullFavoriteWeatherPlacesTargeted: () => pullFavoriteWeatherPlacesTargetedWithVerification(scope),
      inspectFavoriteWeatherPullTestState: () => inspectFavoriteWeatherPullTestState(scope),
      pullFavoriteLaunchSitesTargeted: () => pullFavoriteLaunchSitesTargetedWithVerification(scope),
      inspectFavoriteLaunchSitePullState: () => inspectFavoriteLaunchSitePullState(scope),
      pullPilotProfileTargeted: () => pullPilotProfileTargetedWithVerification(scope),
      inspectPilotProfilePullState: () => inspectPilotProfilePullState(scope),
      pullUnitPreferencesTargeted: () => createBrowserPreferencePullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullUnitPreferences(),
      pullWeatherPreferencesTargeted: () => createBrowserPreferencePullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullWeatherPreferences(),
      pullAviationPreferencesTargeted: () => createBrowserPreferencePullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullAviationPreferences(),
      inspectPreferencePullState: () => inspectPreferencePullState(scope),
      pullBalloonsTargeted: () => createBrowserBalloonPullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullBalloons(),
      inspectBalloonPullState: () => inspectBalloonPullState(scope),
      pullFlightsTargeted: () => createBrowserFlightPullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullFlights(),
      inspectFlightPullState: () => inspectFlightPullState(scope),
      pullLogbookEntriesTargeted: () => createBrowserLogbookEntryPullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullLogbookEntries(),
      inspectLogbookEntryPullState: () => inspectLogbookEntryPullState(scope),
      pullDocumentsTargeted: () => createBrowserDocumentPullService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).pullDocuments(),
      inspectDocumentPullState: () => inspectDocumentPullState(scope),
      bootstrapCloudDataTargeted: async () => {
        const report = await createBrowserCloudBootstrapService({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).bootstrapCloudDataForCurrentUser();
        lastCloudBootstrapReports.set(scope, report);
        return report;
      },
      inspectCloudBootstrapState: () => inspectCloudBootstrapState(scope),
      inspectCloudSyncRuntimeControllerState: async () => inspectCloudSyncRuntimeControllerState(),
      inspectFlightLogbookAutoPushTestState: () => inspectFlightLogbookAutoPushTestState(scope),
      resolveCrudConflictLocalWins: (entityType: string, entityId: string) => createBrowserCrudConflictResolver({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).resolveLocalWins(entityType, entityId),
      resolveCrudConflictServerWins: (entityType: string, entityId: string) => createBrowserCrudConflictResolver({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }).resolveServerWins(entityType, entityId),
      restoreRecordedFlightBackupTargeted: (backup: unknown) => restoreRecordedFlightBackupTargeted(backup, {
        scope,
        getCurrentScope: getRuntimeDataScope,
        getRecordedFlight: (id) => new IndexedDbRecordedFlightStorage().getFlight(id),
        getJournalFlights: () => loadFlightCompletionState().journalFlights,
        persistRecordedFlight: (flight) => new IndexedDbRecordedFlightStorage().completeFlight(flight),
        persistJournalFlight: (flight) => {
          const before = loadFlightCompletionState().journalFlights.some((item) => item.id === flight.id || item.sourceFlightId === flight.id);
          persistJournalFlight(flight);
          return before || loadFlightCompletionState().journalFlights.some((item) => item.id === flight.id || item.sourceFlightId === flight.id);
        },
        enqueueFlightUpsert: (id) => enqueueLocalSyncMutation("flight", id),
      }),
      inspectRecordedFlightBackupRestoreState: async (flightId: string) => {
        const outbox = new IndexedDbSyncOutboxStorage(scope);
        const [recordedFlight, mutations, sidecar] = await Promise.all([
          new IndexedDbRecordedFlightStorage().getFlight(flightId),
          outbox.list(),
          outbox.getMetadata("flight", flightId),
        ]);
        const journalFlight = loadFlightCompletionState().journalFlights.find((item) => item.id === flightId || item.sourceFlightId === flightId) ?? null;
        return {
          flightId,
          recordedFlightPresent: recordedFlight !== null,
          pointsCount: recordedFlight?.points.length ?? 0,
          journalFlightPresent: journalFlight !== null,
          sidecar,
          pendingFlightMutations: mutations.filter((mutation) => mutation.entityType === "flight" && mutation.entityId === flightId),
        } as const;
      },
      inspectFlightTrackSyncState: (flightId: string) => new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).inspect(flightId),
      uploadFlightTrackTargeted: (flightId: string) => new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).upload(flightId),
      downloadFlightTrackTargeted: (flightId: string) => new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).download(flightId),
      inspectFlightTrackQueueState: async () => {
        const queue = new IndexedDbFlightTrackQueueStorage(scope);
        const jobs = await queue.list();
        return { activeUser: scope.slice(5), running: isFlightTrackQueueRunning(scope), pendingJobs: jobs.length, nextEligibleRetryAt: await nextFlightTrackRetryAt(queue), jobs } as const;
      },
      drainFlightTrackQueueTargeted: () => {
        const tracks = new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope);
        return drainFlightTrackQueue({ scope, storage: new IndexedDbFlightTrackQueueStorage(scope), transport: { upload: (id) => tracks.upload(id), download: (id) => tracks.download(id), cleanup: (id) => tracks.cleanup(id) } });
      },
      uploadFlightTrackToR2Targeted: async (flightId: string) => {
        const tracks = new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope);
        const queue = new IndexedDbFlightTrackQueueStorage(scope);
        const stateBefore = await tracks.inspect(flightId);
        const job = await enqueueFlightTrackJob(queue, { scope, flightId, operation: "UPLOAD", generation: stateBefore.generation ?? 1 });
        const targetedQueue = {
          list: async () => (await queue.list()).filter(({ jobId }) => jobId === job.jobId),
          put: (value: Parameters<typeof queue.put>[0]) => queue.put(value),
          remove: (jobId: string) => queue.remove(jobId),
          removeMany: (jobIds: readonly string[]) => queue.removeMany(jobIds),
        };
        let uploadError: Readonly<{ message: string; name: string; httpStatus: number | null; requestId: string | null; bucket: string | null; endpoint: string | null; objectKey: string | null }> | null = null;
        const result = await drainFlightTrackQueue({ scope, storage: targetedQueue, transport: {
          upload: async (id) => {
            try { return await tracks.uploadToR2Targeted(id); }
            catch (error) {
              const details = error as Partial<{ name: string; httpStatus: number; requestId: string; bucket: string; endpoint: string; objectKey: string }>;
              uploadError = {
                message: error instanceof Error ? error.message.replace(/(secret|token|credential|signature)(=|:)[^&\s]+/gi, "$1$2[REDACTED]") : "UNKNOWN_UPLOAD_ERROR",
                name: error instanceof Error ? error.name : "Error",
                httpStatus: typeof details.httpStatus === "number" ? details.httpStatus : Number(error instanceof Error ? error.message.match(/R2_(?:UPLOAD|ENDPOINT)_(\d{3})/)?.[1] ?? NaN : NaN) || null,
                requestId: typeof details.requestId === "string" ? details.requestId : null,
                bucket: typeof details.bucket === "string" ? details.bucket : null,
                endpoint: typeof details.endpoint === "string" ? details.endpoint : null,
                objectKey: typeof details.objectKey === "string" ? details.objectKey : stateBefore.objectKey,
              };
              throw error;
            }
          },
          download: (id) => tracks.download(id),
          cleanup: (id) => tracks.cleanup(id),
        } });
        return { jobId: job.jobId, result, error: uploadError, state: await tracks.inspect(flightId) } as const;
      },
      inspectFlightTrackR2TargetedState: async (flightId: string) => {
        const [state, jobs] = await Promise.all([
          new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).inspect(flightId),
          new IndexedDbFlightTrackQueueStorage(scope).list(),
        ]);
        return { ...state, pendingJobs: jobs.filter((job) => job.flightId === flightId) } as const;
      },
      restoreFlightTrackFromR2Targeted: (flightId: string) => new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).restoreFromR2Targeted(flightId),
      inspectFlightTrackR2RestoreState: async (flightId: string) => {
        const [state, recordedFlight, jobs] = await Promise.all([
          new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope).inspect(flightId),
          new IndexedDbRecordedFlightStorage().getFlight(flightId),
          new IndexedDbFlightTrackQueueStorage(scope).list(),
        ]);
        const journalFlight = loadFlightCompletionState().journalFlights.find((item) => (item.sourceFlightId ?? item.id) === flightId) ?? null;
        return {
          ...state,
          recordedFlightPresent: recordedFlight !== null,
          recordedPoints: recordedFlight?.points.length ?? 0,
          journalFlightPresent: journalFlight !== null,
          journalStatistics: journalFlight?.statistics ?? null,
          pendingJobs: jobs.filter((job) => job.flightId === flightId),
        } as const;
      },
      migrateFlightTrackSupabaseToR2Targeted: (flightId: string, generation = 1) => migrateFlightTrackSupabaseToR2Targeted(flightId, generation),
      replayFlightTrackSupabaseToR2Targeted: (flightId: string, generation = 1) => replayFlightTrackSupabaseToR2Targeted(flightId, generation),
      migrateLegacyFlightTrackToR2Targeted: (flightId: string, generation = 1) => migrateLegacyFlightTrackToR2Targeted(flightId, generation),
    } : null;
    if (controlledApi) window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ = controlledApi;
    const online = () => { if (!controlled) automaticCloudSyncController.notifyOnline(); };
    const mutation = () => { if (!controlled && !manualCloudSyncInProgress) automaticCloudSyncController.notifyLocalMutation(); };
    const visibility = () => { if (!controlled && document.visibilityState === "visible") void automaticCloudSyncController.notifyVisible(); };
    window.addEventListener("online", online);
    window.addEventListener(SYNC_MUTATION_ENQUEUED_EVENT, mutation);
    window.addEventListener(FLIGHT_TRACK_QUEUE_CHANGED_EVENT, mutation);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener(SYNC_MUTATION_ENQUEUED_EVENT, mutation);
      window.removeEventListener(FLIGHT_TRACK_QUEUE_CHANGED_EVENT, mutation);
      document.removeEventListener("visibilitychange", visibility);
      if (controlledApi && window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ === controlledApi) delete window.__BC_CLOUD_SYNC_CONTROLLED_TEST__;
      releaseRuntimeMount();
    };
  }, [auth.state, auth.user, auth.localDataMigrationState, auth.localDataMigrationCollisions, currentSearch]);

  return null;
}
