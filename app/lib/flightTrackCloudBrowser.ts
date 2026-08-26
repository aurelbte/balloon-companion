import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import {
  createFlightTrackBlob,
  encodeFlightTrackBlob,
  FLIGHT_TRACK_BLOB_SCHEMA_VERSION,
  parseFlightTrackBlob,
  safeFlightTrackObjectKey,
  sha256Hex,
} from "./flightTrackBlob.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { applyRecordedFlightToJournalFromCloudWithoutEnqueue, loadFlightCompletionState } from "./flightCompletionStorage.ts";
import { enqueueFlightTrackJob, type FlightTrackQueueStorage } from "./flightTrackQueue.ts";
import { R2FlightTrackBlobProvider, SupabaseLegacyFlightTrackBlobProvider, type FlightTrackBlobProvider, type FlightTrackProviderName } from "./flightTrackBlobProvider.ts";

type RemoteTrack = Readonly<{
  objectKey: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  generation: number;
  status: string;
  deletedAt: string | null;
  provider: FlightTrackProviderName | null;
}>;

export type FlightTrackSyncState = Readonly<{
  flightId: string;
  localPoints: number;
  remoteAvailable: boolean;
  objectKey: string | null;
  generation: number | null;
  checksum: string | null;
  uploadPending: boolean;
  downloadState: "LOCAL_COMPLETE" | "REMOTE_AVAILABLE" | "LOCAL_ONLY" | "DELETED";
  provider: FlightTrackProviderName | null;
}>;

export class BrowserFlightTrackCloudService {
  private readonly client: SupabaseClient;
  private readonly scope: `USER:${string}`;
  private readonly storage: Pick<IndexedDbRecordedFlightStorage, "getFlight" | "listFlights" | "hydrateTrackFromCloudWithoutEnqueue">;
  private readonly r2Provider: FlightTrackBlobProvider;
  private readonly legacyProvider: FlightTrackBlobProvider;
  constructor(
    client: SupabaseClient,
    scope: `USER:${string}`,
    storage: Pick<IndexedDbRecordedFlightStorage, "getFlight" | "listFlights" | "hydrateTrackFromCloudWithoutEnqueue"> = new IndexedDbRecordedFlightStorage(),
    providers: Readonly<{ r2?: FlightTrackBlobProvider; legacy?: FlightTrackBlobProvider }> = {},
  ) {
    this.client = client; this.scope = scope; this.storage = storage;
    this.r2Provider = providers.r2 ?? new R2FlightTrackBlobProvider();
    this.legacyProvider = providers.legacy ?? new SupabaseLegacyFlightTrackBlobProvider(client.storage);
  }

  private userId(): string {
    if (getRuntimeDataScope() !== this.scope) throw new Error("TRACK_USER_SWITCH");
    return this.scope.slice(5);
  }

  private async rebuildJournalFromLocalTrace(flightId: string): Promise<boolean> {
    const flight = await this.storage.getFlight(flightId);
    if (!flight?.points.length || typeof window === "undefined") return false;
    const journal = loadFlightCompletionState().journalFlights.find((item) => (item.sourceFlightId ?? item.id) === flightId);
    if (!journal) return false;
    return applyRecordedFlightToJournalFromCloudWithoutEnqueue(this.scope, flightId, flight, {
      customTitle: journal.customTitle ?? null,
      origin: journal.origin,
      logbookStatus: journal.logbookStatus,
      recovered: journal.recovered ?? false,
    }, window.localStorage, "TRACK_RECONSTRUCTION");
  }

  private async remote(flightId: string): Promise<RemoteTrack | null> {
    const userId = this.userId();
    const { data, error } = await this.client.from("flights")
      .select("object_key,checksum,blob_size,blob_status,track_generation,deleted_at,storage_provider")
      .eq("user_id", userId).eq("id", flightId).maybeSingle();
    if (error) throw new Error(`TRACK_METADATA_READ:${error.code ?? "UNKNOWN"}`);
    if (!data) return null;
    return {
      objectKey: data.object_key,
      checksum: data.checksum,
      sizeBytes: data.blob_size == null ? null : Number(data.blob_size),
      generation: Number(data.track_generation ?? 1),
      status: data.blob_status,
      deletedAt: data.deleted_at,
      provider: data.storage_provider === "R2" ? "R2" : data.storage_provider === "SUPABASE_STORAGE" ? "SUPABASE_STORAGE" : null,
    };
  }

  async inspect(flightId: string): Promise<FlightTrackSyncState> {
    const [flight, remote] = await Promise.all([this.storage.getFlight(flightId), this.remote(flightId)]);
    const localPoints = flight?.points.length ?? 0;
    const remoteAvailable = remote?.status === "READY" && Boolean(remote.objectKey && remote.checksum);
    return {
      flightId,
      localPoints,
      remoteAvailable,
      objectKey: remote?.objectKey ?? null,
      generation: remote?.generation ?? null,
      checksum: remote?.checksum ?? null,
      uploadPending: localPoints > 0 && !remoteAvailable && !remote?.deletedAt,
      downloadState: remote?.deletedAt ? "DELETED" : localPoints > 0 ? "LOCAL_COMPLETE" : remoteAvailable ? "REMOTE_AVAILABLE" : "LOCAL_ONLY",
      provider: remote?.provider ?? null,
    };
  }

  private async uploadInternal(flightId: string, forceR2: boolean): Promise<FlightTrackSyncState> {
    const userId = this.userId();
    const flight = await this.storage.getFlight(flightId);
    if (!flight || flight.points.length === 0) throw new Error("LOCAL_TRACK_NOT_FOUND");
    const remote = await this.remote(flightId);
    if (!remote || remote.deletedAt) throw new Error("REMOTE_FLIGHT_NOT_AVAILABLE");
    if (!forceR2 && remote.status === "READY" && remote.objectKey && remote.checksum) return this.inspect(flightId);
    const generation = remote.generation || 1;
    const bytes = encodeFlightTrackBlob(createFlightTrackBlob(flight));
    const checksum = await sha256Hex(bytes);
    this.userId();
    const { objectKey } = await this.r2Provider.upload({ flightId, generation, bytes, checksum, diagnostics: forceR2 });
    this.userId();
    const { error: updateError } = await this.client.from("flights").update({
      storage_provider: "R2",
      object_key: objectKey,
      format_version: FLIGHT_TRACK_BLOB_SCHEMA_VERSION,
      checksum,
      blob_status: "READY",
      blob_size: bytes.byteLength,
      track_generation: generation,
    }).eq("user_id", userId).eq("id", flightId).is("deleted_at", null);
    if (updateError) throw new Error(`TRACK_METADATA_UPDATE:${updateError.code ?? "UNKNOWN"}`);
    return this.inspect(flightId);
  }

  async upload(flightId: string): Promise<FlightTrackSyncState> {
    return this.uploadInternal(flightId, false);
  }

  /** DEV targeted transition only: uploads the local trace to R2 even when legacy metadata is READY. */
  async uploadToR2Targeted(flightId: string): Promise<FlightTrackSyncState> {
    return this.uploadInternal(flightId, true);
  }

  async download(flightId: string): Promise<FlightTrackSyncState> {
    const local = await this.storage.getFlight(flightId);
    if (!local) throw new Error("LOCAL_FLIGHT_METADATA_NOT_FOUND");
    if (local.points.length > 0) { await this.rebuildJournalFromLocalTrace(flightId); return this.inspect(flightId); }
    const remote = await this.remote(flightId);
    if (!remote || remote.deletedAt || remote.status !== "READY" || !remote.objectKey || !remote.checksum) throw new Error("REMOTE_TRACK_NOT_AVAILABLE");
    const provider = remote.provider === "R2" ? this.r2Provider : this.legacyProvider;
    if (provider.name === "SUPABASE_STORAGE") {
      const expectedKey = safeFlightTrackObjectKey(this.userId(), flightId, remote.generation);
      if (remote.objectKey !== expectedKey) throw new Error("INVALID_REMOTE_OBJECT_KEY");
    }
    const bytes = await provider.download({ flightId, generation: remote.generation, objectKey: remote.objectKey });
    if (remote.sizeBytes !== null && bytes.byteLength !== remote.sizeBytes) throw new Error("TRACK_SIZE_MISMATCH");
    if (await sha256Hex(bytes) !== remote.checksum) throw new Error("TRACK_CHECKSUM_MISMATCH");
    const blob = parseFlightTrackBlob(bytes, flightId);
    this.userId();
    if (!await this.storage.hydrateTrackFromCloudWithoutEnqueue(this.scope, flightId, blob.points)) throw new Error("TRACK_LOCAL_IMPORT_REFUSED");
    const hydrated = await this.storage.getFlight(flightId);
    const journal = loadFlightCompletionState().journalFlights.find((item) => (item.sourceFlightId ?? item.id) === flightId);
    if (hydrated && journal && !applyRecordedFlightToJournalFromCloudWithoutEnqueue(this.scope, flightId, hydrated, {
      customTitle: journal.customTitle ?? null,
      origin: journal.origin,
      logbookStatus: journal.logbookStatus,
      recovered: journal.recovered ?? false,
    }, window.localStorage, "TRACK_RECONSTRUCTION")) throw new Error("TRACK_JOURNAL_REBUILD_REFUSED");
    return this.inspect(flightId);
  }

  async uploadPendingTracks(): Promise<number> {
    let uploaded = 0;
    for (const flight of await this.storage.listFlights()) {
      if (flight.status !== "COMPLETED" || flight.points.length === 0) continue;
      const state = await this.inspect(flight.id);
      if (!state.uploadPending) continue;
      await this.upload(flight.id);
      uploaded += 1;
    }
    return uploaded;
  }

  async cleanupDeletedTracks(): Promise<number> {
    const userId = this.userId();
    const { data, error } = await this.client.from("flights")
      .select("id,object_key,track_generation,storage_provider")
      .eq("user_id", userId).not("deleted_at", "is", null).eq("blob_status", "READY");
    if (error) throw new Error(`TRACK_CLEANUP_READ:${error.code ?? "UNKNOWN"}`);
    let cleaned = 0;
    for (const row of data ?? []) {
      const generation = Number(row.track_generation ?? 1);
      const provider = row.storage_provider === "R2" ? this.r2Provider : this.legacyProvider;
      if (provider.name === "SUPABASE_STORAGE" && row.object_key !== safeFlightTrackObjectKey(userId, row.id, generation)) throw new Error("INVALID_REMOTE_OBJECT_KEY");
      await provider.delete({ flightId: row.id, generation, objectKey: row.object_key });
      this.userId();
      const { error: updateError } = await this.client.from("flights").update({ object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", storage_provider: null, format_version: null })
        .eq("user_id", userId).eq("id", row.id).not("deleted_at", "is", null);
      if (updateError) throw new Error(`TRACK_CLEANUP_METADATA:${updateError.code ?? "UNKNOWN"}`);
      cleaned += 1;
    }
    return cleaned;
  }

  async cleanup(flightId: string): Promise<void> {
    const userId = this.userId();
    const { data, error } = await this.client.from("flights").select("id,object_key,track_generation,deleted_at,storage_provider")
      .eq("user_id", userId).eq("id", flightId).maybeSingle();
    if (error) throw new Error(`TRACK_CLEANUP_READ:${error.code ?? "UNKNOWN"}`);
    if (!data || !data.object_key) return;
    if (!data.deleted_at) throw new Error("TRACK_CLEANUP_BEFORE_TOMBSTONE");
    const generation = Number(data.track_generation ?? 1);
    const providerName = data.storage_provider === "R2" ? "R2" : "SUPABASE_STORAGE";
    if (providerName === "SUPABASE_STORAGE" && data.object_key !== safeFlightTrackObjectKey(userId, flightId, generation)) throw new Error("INVALID_REMOTE_OBJECT_KEY");
    await (providerName === "R2" ? this.r2Provider : this.legacyProvider).delete({ flightId, generation, objectKey: data.object_key });
    this.userId();
    const { error: updateError } = await this.client.from("flights").update({ object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", storage_provider: null, format_version: null })
      .eq("user_id", userId).eq("id", flightId).not("deleted_at", "is", null);
    if (updateError) throw new Error(`TRACK_CLEANUP_METADATA:${updateError.code ?? "UNKNOWN"}`);
  }

  async discoverPendingJobs(queue: FlightTrackQueueStorage): Promise<number> {
    let created = 0;
    for (const flight of await this.storage.listFlights()) {
      if (flight.status !== "COMPLETED" || flight.points.length === 0) continue;
      await this.rebuildJournalFromLocalTrace(flight.id);
      const state = await this.inspect(flight.id);
      if (!state.uploadPending) continue;
      await enqueueFlightTrackJob(queue, { scope: this.scope, flightId: flight.id, operation: "UPLOAD", generation: state.generation ?? 1 });
      created += 1;
    }
    const userId = this.userId();
    const { data, error } = await this.client.from("flights").select("id,object_key,track_generation")
      .eq("user_id", userId).not("deleted_at", "is", null).eq("blob_status", "READY");
    if (error) throw new Error(`TRACK_CLEANUP_READ:${error.code ?? "UNKNOWN"}`);
    for (const row of data ?? []) {
      await enqueueFlightTrackJob(queue, { scope: this.scope, flightId: row.id, operation: "DELETE", generation: Number(row.track_generation ?? 1), ...(row.object_key ? { objectKey: row.object_key } : {}) });
      created += 1;
    }
    return created;
  }
}
