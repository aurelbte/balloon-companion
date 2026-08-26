export type FlightTrackProviderName = "R2" | "SUPABASE_STORAGE";

export interface FlightTrackBlobProvider {
  readonly name: FlightTrackProviderName;
  upload(input: Readonly<{ flightId: string; generation: number; bytes: Uint8Array; checksum: string }>): Promise<Readonly<{ objectKey: string }>>;
  download(input: Readonly<{ flightId: string; generation: number; objectKey: string }>): Promise<Uint8Array>;
  delete(input: Readonly<{ flightId: string; generation: number; objectKey: string }>): Promise<void>;
}

type SignedResponse = Readonly<{ url: string; objectKey: string; expiresInSeconds: number }>;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function endpoint(action: string, body: Record<string, unknown>): Promise<SignedResponse> {
  const response = await fetchWithTimeout("/api/cloud/flight-tracks", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  }, 15_000);
  if (!response.ok) throw new Error(`R2_ENDPOINT_${response.status}`);
  return response.json() as Promise<SignedResponse>;
}

export async function migrateFlightTrackSupabaseToR2Targeted(flightId: string, generation = 1): Promise<unknown> {
  return endpoint("MIGRATE_LEGACY", { flightId, generation });
}

export const migrateLegacyFlightTrackToR2Targeted = migrateFlightTrackSupabaseToR2Targeted;

export class R2FlightTrackBlobProvider implements FlightTrackBlobProvider {
  readonly name = "R2" as const;
  async upload(input: Readonly<{ flightId: string; generation: number; bytes: Uint8Array; checksum: string }>) {
    const signed = await endpoint("UPLOAD_URL", { flightId: input.flightId, generation: input.generation, sizeBytes: input.bytes.byteLength, checksum: input.checksum });
    const response = await fetchWithTimeout(signed.url, { method: "PUT", headers: { "content-type": "application/json", "x-amz-meta-sha256": input.checksum }, body: input.bytes.slice().buffer }, 60_000);
    if (!response.ok) throw new Error(`R2_UPLOAD_${response.status}`);
    return { objectKey: signed.objectKey };
  }
  async download(input: Readonly<{ flightId: string; generation: number; objectKey: string }>) {
    const signed = await endpoint("DOWNLOAD_URL", input);
    if (signed.objectKey !== input.objectKey) throw new Error("R2_OBJECT_KEY_MISMATCH");
    const response = await fetchWithTimeout(signed.url, { cache: "no-store" }, 60_000);
    if (!response.ok) throw new Error(`R2_DOWNLOAD_${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async delete(input: Readonly<{ flightId: string; generation: number; objectKey: string }>) {
    await endpoint("DELETE", input);
  }
}

export class SupabaseLegacyFlightTrackBlobProvider implements FlightTrackBlobProvider {
  readonly name = "SUPABASE_STORAGE" as const;
  private readonly storage: Readonly<{ from(bucket: string): { download(key: string): Promise<{ data: Blob | null; error: { message: string } | null }>; remove(keys: string[]): Promise<{ error: { message: string } | null }> } }>;
  private readonly bucket: string;
  constructor(storage: Readonly<{ from(bucket: string): { download(key: string): Promise<{ data: Blob | null; error: { message: string } | null }>; remove(keys: string[]): Promise<{ error: { message: string } | null }> } }>, bucket = "flight-tracks") {
    this.storage = storage;
    this.bucket = bucket;
  }
  async upload(): Promise<Readonly<{ objectKey: string }>> { throw new Error("LEGACY_PROVIDER_UPLOAD_DISABLED"); }
  async download(input: Readonly<{ objectKey: string }>) {
    const { data, error } = await this.storage.from(this.bucket).download(input.objectKey);
    if (error || !data) throw new Error(`LEGACY_TRACK_DOWNLOAD:${error?.message ?? "EMPTY"}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  async delete(input: Readonly<{ objectKey: string }>) {
    const { error } = await this.storage.from(this.bucket).remove([input.objectKey]);
    if (error && !/not.?found/i.test(error.message)) throw new Error(`LEGACY_TRACK_DELETE:${error.message}`);
  }
}
