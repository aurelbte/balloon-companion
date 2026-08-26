import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_FLIGHT_TRACK_BYTES, parseFlightTrackBlob, sha256Hex } from "./flightTrackBlob.ts";
import type { AuthorizedFlightTrack } from "./flightTrackR2Authorization.ts";

const SIGNED_URL_TTL_SECONDS = 300;

type R2Config = Readonly<{ accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string }>;
export function r2Config(environment: NodeJS.ProcessEnv = process.env): R2Config {
  const accountId = environment.R2_ACCOUNT_ID;
  const accessKeyId = environment.R2_ACCESS_KEY_ID;
  const secretAccessKey = environment.R2_SECRET_ACCESS_KEY;
  const bucket = environment.R2_BUCKET_FLIGHT_TRACKS;
  const endpoint = environment.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) throw new Error("R2_SERVER_CONFIGURATION_MISSING");
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

function client(config: R2Config): S3Client {
  return new S3Client({ region: "auto", endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}

export async function createR2UploadUrl(target: AuthorizedFlightTrack, input: Readonly<{ sizeBytes: unknown; checksum: unknown }>, environment?: NodeJS.ProcessEnv) {
  if (target.deletedAt) throw new Error("FLIGHT_DELETED");
  if (!Number.isInteger(input.sizeBytes) || Number(input.sizeBytes) < 1 || Number(input.sizeBytes) > MAX_FLIGHT_TRACK_BYTES || typeof input.checksum !== "string" || !/^[a-f0-9]{64}$/.test(input.checksum)) throw new Error("INVALID_TRACK_UPLOAD_METADATA");
  const config = r2Config(environment);
  const url = await getSignedUrl(client(config), new PutObjectCommand({ Bucket: config.bucket, Key: target.objectKey, ContentType: "application/json", Metadata: { sha256: input.checksum } }), { expiresIn: SIGNED_URL_TTL_SECONDS });
  return { url, objectKey: target.objectKey, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}

export async function createR2DownloadUrl(target: AuthorizedFlightTrack, environment?: NodeJS.ProcessEnv) {
  if (target.storageProvider !== "R2") throw new Error("TRACK_NOT_ON_R2");
  const config = r2Config(environment);
  const url = await getSignedUrl(client(config), new GetObjectCommand({ Bucket: config.bucket, Key: target.objectKey }), { expiresIn: SIGNED_URL_TTL_SECONDS });
  return { url, objectKey: target.objectKey, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}

export async function deleteR2Track(target: AuthorizedFlightTrack, environment?: NodeJS.ProcessEnv): Promise<void> {
  if (!target.deletedAt) throw new Error("TRACK_DELETE_REQUIRES_TOMBSTONE");
  if (target.storageProvider !== "R2") throw new Error("TRACK_NOT_ON_R2");
  const config = r2Config(environment);
  await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: target.objectKey }));
}

/** One-shot, owner-scoped migration. The legacy object is deliberately retained. */
export async function migrateLegacyFlightTrackToR2(supabase: SupabaseClient, target: AuthorizedFlightTrack, environment?: NodeJS.ProcessEnv) {
  const { data: row, error: rowError } = await supabase.from("flights").select("object_key,checksum,blob_size,storage_provider").eq("id", target.flightId).eq("user_id", target.userId).maybeSingle();
  if (rowError || !row || row.storage_provider !== "SUPABASE_STORAGE" || typeof row.object_key !== "string" || typeof row.checksum !== "string") throw new Error("LEGACY_TRACK_NOT_MIGRATABLE");
  const { data: legacy, error: downloadError } = await supabase.storage.from("flight-tracks").download(row.object_key);
  if (downloadError || !legacy) throw new Error("LEGACY_TRACK_DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await legacy.arrayBuffer());
  if (row.blob_size != null && Number(row.blob_size) !== bytes.byteLength) throw new Error("LEGACY_TRACK_SIZE_MISMATCH");
  const checksum = await sha256Hex(bytes);
  if (checksum !== row.checksum) throw new Error("LEGACY_TRACK_CHECKSUM_MISMATCH");
  parseFlightTrackBlob(bytes, target.flightId);
  const config = r2Config(environment);
  await client(config).send(new PutObjectCommand({ Bucket: config.bucket, Key: target.objectKey, Body: bytes, ContentType: "application/json", Metadata: { sha256: checksum } }));
  const { error: updateError } = await supabase.from("flights").update({ storage_provider: "R2", object_key: target.objectKey }).eq("id", target.flightId).eq("user_id", target.userId).eq("storage_provider", "SUPABASE_STORAGE");
  if (updateError) throw new Error("LEGACY_TRACK_METADATA_UPDATE_FAILED");
  return { migrated: true, objectKey: target.objectKey, checksum, sizeBytes: bytes.byteLength, legacyObjectRetained: true } as const;
}
