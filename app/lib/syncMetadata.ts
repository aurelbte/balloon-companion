export const INITIAL_SYNC_REVISION = 0;

export type SyncMetadata = Readonly<{
  revision: number;
  updatedAt: string;
  deletedAt?: string;
}>;

export type BlobStatus = "LOCAL_ONLY" | "PENDING" | "READY" | "FAILED";

export type CloudBlobReference = Readonly<{
  storageProvider: string;
  objectKey: string;
  formatVersion: number;
  checksum: string;
  blobStatus: BlobStatus;
}>;

export function createInitialSyncMetadata(
  updatedAt = new Date().toISOString(),
  deletedAt?: string,
): SyncMetadata {
  return {
    revision: INITIAL_SYNC_REVISION,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
  };
}
