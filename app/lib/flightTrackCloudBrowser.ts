import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import {
  createFlightTrackBlob,
  encodeFlightTrackBlob,
  FLIGHT_TRACK_BLOB_SCHEMA_VERSION,
  FLIGHT_TRACK_BUCKET,
  parseFlightTrackBlob,
  safeFlightTrackObjectKey,
  sha256Hex,
} from "./flightTrackBlob.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { applyRecordedFlightToJournalFromCloudWithoutEnqueue, loadFlightCompletionState } from "./flightCompletionStorage.ts";
import { enqueueFlightTrackJob, type FlightTrackQueueStorage } from "./flightTrackQueue.ts";

type RemoteTrack = Readonly<{
  objectKey: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  generation: number;
  status: string;
  deletedAt: string | null;
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
}>;

export class BrowserFlightTrackCloudService {
  private readonly client: SupabaseClient;
  private readonly scope: `USER:${string}`;
  private readonly storage: Pick<IndexedDbRecordedFlightStorage, "getFlight" | "listFlights" | "hydrateTrackFromCloudWithoutEnqueue">;
  constructor(
    client: SupabaseClient,
    scope: `USER:${string}`,
    storage: Pick<IndexedDbRecordedFlightStorage, "getFlight" | "listFlights" | "hydrateTrackFromCloudWithoutEnqueue"> = new IndexedDbRecordedFlightStorage(),
  ) { this.client = client; this.scope = scope; this.storage = storage; }

  private userId(): string {
    if (getRuntimeDataScope() !== this.scope) throw new Error("TRACK_USER_SWITCH");
    return this.scope.slice(5);
  }

  private async remote(flightId: string): Promise<RemoteTrack | null> {
    const userId = this.userId();
    const { data, error } = await this.client.from("flights")
      .select("object_key,checksum,blob_size,blob_status,track_generation,deleted_at")
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
    };
  }

  async upload(flightId: string): Promise<FlightTrackSyncState> {
    const userId = this.userId();
    const flight = await this.storage.getFlight(flightId);
    if (!flight || flight.points.length === 0) throw new Error("LOCAL_TRACK_NOT_FOUND");
    const remote = await this.remote(flightId);
    if (!remote || remote.deletedAt) throw new Error("REMOTE_FLIGHT_NOT_AVAILABLE");
    if (remote.status === "READY" && remote.objectKey && remote.checksum) return this.inspect(flightId);
    const generation = remote.generation || 1;
    const objectKey = safeFlightTrackObjectKey(userId, flightId, generation);
    const bytes = encodeFlightTrackBlob(createFlightTrackBlob(flight));
    const checksum = await sha256Hex(bytes);
    this.userId();
    const { error: uploadError } = await this.client.storage.from(FLIGHT_TRACK_BUCKET)
      .upload(objectKey, new Blob([bytes.slice().buffer], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (uploadError) throw new Error(`TRACK_UPLOAD:${uploadError.message}`);
    this.userId();
    const { error: updateError } = await this.client.from("flights").update({
      storage_provider: "SUPABASE_STORAGE",
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

  async download(flightId: string): Promise<FlightTrackSyncState> {
    const local = await this.storage.getFlight(flightId);
    if (!local) throw new Error("LOCAL_FLIGHT_METADATA_NOT_FOUND");
    if (local.points.length > 0) return this.inspect(flightId);
    const remote = await this.remote(flightId);
    if (!remote || remote.deletedAt || remote.status !== "READY" || !remote.objectKey || !remote.checksum) throw new Error("REMOTE_TRACK_NOT_AVAILABLE");
    const expectedKey = safeFlightTrackObjectKey(this.userId(), flightId, remote.generation);
    if (remote.objectKey !== expectedKey) throw new Error("INVALID_REMOTE_OBJECT_KEY");
    const { data, error } = await this.client.storage.from(FLIGHT_TRACK_BUCKET).download(expectedKey);
    if (error || !data) throw new Error(`TRACK_DOWNLOAD:${error?.message ?? "EMPTY"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
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
    })) throw new Error("TRACK_JOURNAL_REBUILD_REFUSED");
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
      .select("id,object_key,track_generation")
      .eq("user_id", userId).not("deleted_at", "is", null).eq("blob_status", "READY");
    if (error) throw new Error(`TRACK_CLEANUP_READ:${error.code ?? "UNKNOWN"}`);
    let cleaned = 0;
    for (const row of data ?? []) {
      const expectedKey = safeFlightTrackObjectKey(userId, row.id, Number(row.track_generation ?? 1));
      if (row.object_key !== expectedKey) throw new Error("INVALID_REMOTE_OBJECT_KEY");
      const { error: removeError } = await this.client.storage.from(FLIGHT_TRACK_BUCKET).remove([expectedKey]);
      if (removeError) throw new Error(`TRACK_CLEANUP:${removeError.message}`);
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
    const { data, error } = await this.client.from("flights").select("id,object_key,track_generation,deleted_at")
      .eq("user_id", userId).eq("id", flightId).maybeSingle();
    if (error) throw new Error(`TRACK_CLEANUP_READ:${error.code ?? "UNKNOWN"}`);
    if (!data || !data.object_key) return;
    if (!data.deleted_at) throw new Error("TRACK_CLEANUP_BEFORE_TOMBSTONE");
    const expectedKey = safeFlightTrackObjectKey(userId, flightId, Number(data.track_generation ?? 1));
    if (data.object_key !== expectedKey) throw new Error("INVALID_REMOTE_OBJECT_KEY");
    const { error: removeError } = await this.client.storage.from(FLIGHT_TRACK_BUCKET).remove([expectedKey]);
    if (removeError) throw new Error(`TRACK_CLEANUP:${removeError.message}`);
    this.userId();
    const { error: updateError } = await this.client.from("flights").update({ object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", storage_provider: null, format_version: null })
      .eq("user_id", userId).eq("id", flightId).not("deleted_at", "is", null);
    if (updateError) throw new Error(`TRACK_CLEANUP_METADATA:${updateError.code ?? "UNKNOWN"}`);
  }

  async discoverPendingJobs(queue: FlightTrackQueueStorage): Promise<number> {
    let created = 0;
    for (const flight of await this.storage.listFlights()) {
      if (flight.status !== "COMPLETED" || flight.points.length === 0) continue;
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
