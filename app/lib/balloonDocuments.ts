export type BalloonDocumentCategory =
  | "AIRWORTHINESS_CERTIFICATE"
  | "AIRWORTHINESS_REVIEW"
  | "REGISTRATION_CERTIFICATE"
  | "INSURANCE"
  | "AIRCRAFT_STATION_LICENCE"
  | "FLIGHT_MANUAL"
  | "FLIGHT_MANUAL_SUPPLEMENT"
  | "WEIGHING_SHEET"
  | "MAINTENANCE"
  | "CYLINDER_CERTIFICATE"
  | "OTHER";

export type BalloonDocument = Readonly<{
  id: string;
  balloonId: string;
  category: BalloonDocumentCategory;
  customLabel?: string;
  fileName: string;
  mimeType: string;
  addedAt: string;
  issueDate?: string;
  expiryDate?: string;
  issuer?: string;
  documentNumber?: string;
  notes?: string;
  storageReference?: string;
}>;

export type BalloonDocumentStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NO_EXPIRY" | "MISSING";

export function deriveBalloonDocumentStatus(document: BalloonDocument | undefined, now: Date, expiringSoonDays = 30): BalloonDocumentStatus {
  if (!document) return "MISSING";
  if (!document.expiryDate) return "NO_EXPIRY";
  const expiry = new Date(/^\d{4}-\d{2}-\d{2}$/.test(document.expiryDate) ? `${document.expiryDate}T23:59:59.999Z` : document.expiryDate).getTime();
  if (!Number.isFinite(expiry)) return "NO_EXPIRY";
  const remainingMs = expiry - now.getTime();
  if (remainingMs < 0) return "EXPIRED";
  return remainingMs <= expiringSoonDays * 86_400_000 ? "EXPIRING_SOON" : "VALID";
}

/** Abstraction prévue pour IndexedDB puis, éventuellement, une synchronisation distante. */
export interface BalloonDocumentStorage {
  list(balloonId: string): Promise<readonly BalloonDocument[]>;
  getFile(storageReference: string): Promise<Blob | null>;
  save(document: BalloonDocument, file: Blob): Promise<void>;
  remove(documentId: string): Promise<void>;
}
