export type BalloonDocumentCategory =
  | "REGISTRATION_CERTIFICATE"
  | "AIRWORTHINESS_CERTIFICATE"
  | "INSURANCE"
  | "AIRCRAFT_STATION_LICENCE"
  | "FLIGHT_MANUAL"
  | "FLIGHT_MANUAL_SUPPLEMENT"
  | "WEIGHING_SHEET"
  | "INSPECTIONS"
  | "OTHER";

export type BalloonDocument = Readonly<{
  id: string;
  balloonId: string;
  category: BalloonDocumentCategory;
  title: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  /** Présent uniquement lorsqu'un fichier existe réellement sur cet appareil. */
  storageKey?: string;
  notes?: string;
  issueDate?: string;
  expiryDate?: string;
}>;

export const BALLOON_DOCUMENT_CATEGORIES = Object.freeze([
  ["REGISTRATION_CERTIFICATE", "Certificat d’immatriculation"],
  ["AIRWORTHINESS_CERTIFICATE", "Certificat de navigabilité — CDN"],
  ["INSURANCE", "Assurance"],
  ["AIRCRAFT_STATION_LICENCE", "Licence de station d’aéronef — LSA"],
  ["FLIGHT_MANUAL", "Manuel de vol"],
  ["FLIGHT_MANUAL_SUPPLEMENT", "Supplément du manuel"],
  ["WEIGHING_SHEET", "Fiche de pesée"],
  ["INSPECTIONS", "Contrôles"],
  ["OTHER", "Autre"],
] as const satisfies readonly (readonly [BalloonDocumentCategory, string])[]);

export const BALLOON_DOCUMENT_CATEGORY_ORDER = Object.freeze(BALLOON_DOCUMENT_CATEGORIES.map(([category]) => category));

export type BalloonDocumentPrimaryCard = Readonly<{
  id: string;
  label: string;
  categories: readonly BalloonDocumentCategory[];
  addCategory: BalloonDocumentCategory;
  suggestedTitle: string;
  icon: "registration" | "airworthiness" | "insurance" | "radio" | "manual" | "weighing" | "inspections" | "other";
}>;

export const BALLOON_DOCUMENT_PRIMARY_CARDS = Object.freeze([
  { id: "registration", label: "Immatriculation", categories: ["REGISTRATION_CERTIFICATE"], addCategory: "REGISTRATION_CERTIFICATE", suggestedTitle: "Certificat d’immatriculation", icon: "registration" },
  { id: "airworthiness", label: "CDN", categories: ["AIRWORTHINESS_CERTIFICATE"], addCategory: "AIRWORTHINESS_CERTIFICATE", suggestedTitle: "Certificat de navigabilité", icon: "airworthiness" },
  { id: "insurance", label: "Assurance", categories: ["INSURANCE"], addCategory: "INSURANCE", suggestedTitle: "Assurance", icon: "insurance" },
  { id: "radio", label: "LSA", categories: ["AIRCRAFT_STATION_LICENCE"], addCategory: "AIRCRAFT_STATION_LICENCE", suggestedTitle: "Licence de station d’aéronef", icon: "radio" },
  { id: "manual", label: "Manuel de vol", categories: ["FLIGHT_MANUAL", "FLIGHT_MANUAL_SUPPLEMENT"], addCategory: "FLIGHT_MANUAL", suggestedTitle: "Manuel de vol", icon: "manual" },
  { id: "weighing", label: "Fiche de pesée", categories: ["WEIGHING_SHEET"], addCategory: "WEIGHING_SHEET", suggestedTitle: "Fiche de pesée", icon: "weighing" },
  { id: "inspections", label: "Contrôles", categories: ["INSPECTIONS"], addCategory: "INSPECTIONS", suggestedTitle: "Contrôle", icon: "inspections" },
  { id: "other", label: "Autres", categories: ["OTHER"], addCategory: "OTHER", suggestedTitle: "Document", icon: "other" },
] as const satisfies readonly BalloonDocumentPrimaryCard[]);

export function documentsForPrimaryCard(documents: readonly BalloonDocument[], card: BalloonDocumentPrimaryCard): BalloonDocument[] {
  return sortBalloonDocuments(documents.filter((document) => card.categories.includes(document.category)));
}

export function balloonDocumentCardHref(balloonId: string, card: BalloonDocumentPrimaryCard, documents: readonly BalloonDocument[]): string {
  const base = `/more/profile/balloons/${encodeURIComponent(balloonId)}/documents`;
  const matching = documentsForPrimaryCard(documents, card);
  if (matching.length === 0) return `${base}/new?category=${card.addCategory}`;
  if (matching.length === 1) return `${base}/${encodeURIComponent(matching[0].id)}`;
  return `${base}?group=${encodeURIComponent(card.id)}`;
}

export function balloonDocumentPrimaryCardById(id: string | null): BalloonDocumentPrimaryCard | null {
  return BALLOON_DOCUMENT_PRIMARY_CARDS.find((card) => card.id === id) ?? null;
}

export function balloonDocumentCategoryLabel(category: BalloonDocumentCategory): string {
  return BALLOON_DOCUMENT_CATEGORIES.find(([candidate]) => candidate === category)?.[1] ?? "Autre";
}

export function sortBalloonDocuments(documents: readonly BalloonDocument[]): BalloonDocument[] {
  return [...documents].sort((a, b) => {
    const categoryDifference = BALLOON_DOCUMENT_CATEGORY_ORDER.indexOf(a.category) - BALLOON_DOCUMENT_CATEGORY_ORDER.indexOf(b.category);
    return categoryDifference || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}

export const BALLOON_DOCUMENT_MAX_SIZE_BYTES = 25 * 1024 * 1024;
export const BALLOON_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

const DOCUMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
});

export function supportedBalloonDocumentMimeType(file: Pick<File, "name" | "type">): string | null {
  const declaredMimeType = file.type.toLowerCase();
  if (Object.values(DOCUMENT_MIME_BY_EXTENSION).includes(declaredMimeType)) return declaredMimeType;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? DOCUMENT_MIME_BY_EXTENSION[extension] ?? null : null;
}

export function validateBalloonDocumentFile(file: Pick<File, "name" | "type" | "size">): string | null {
  if (file.size > BALLOON_DOCUMENT_MAX_SIZE_BYTES) return "Le fichier dépasse la limite de 25 Mo.";
  if (file.size <= 0) return "Le fichier est vide.";
  if (!supportedBalloonDocumentMimeType(file)) return "Ce format de fichier n’est pas pris en charge.";
  return null;
}

export function documentTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Document";
}

export type NewBalloonDocumentMetadata = Readonly<{ balloonId: string; category: BalloonDocumentCategory; title: string; notes?: string; issueDate?: string; expiryDate?: string }>;
export type BalloonDocumentChanges = Readonly<Partial<Pick<BalloonDocument, "title" | "category" | "notes" | "issueDate" | "expiryDate">>>;

export interface BalloonDocumentStorage {
  listByBalloonId(balloonId: string): Promise<readonly BalloonDocument[]>;
  getDocument(documentId: string): Promise<BalloonDocument | null>;
  getDocumentFile(documentId: string): Promise<Blob | null>;
  addDocument(metadata: NewBalloonDocumentMetadata, file: File): Promise<BalloonDocument>;
  updateDocument(documentId: string, changes: BalloonDocumentChanges): Promise<BalloonDocument>;
  replaceDocumentFile(documentId: string, file: File): Promise<BalloonDocument>;
  deleteDocument(documentId: string): Promise<void>;
  countByBalloonId(balloonId: string): Promise<number>;
  deleteByBalloonId(balloonId: string): Promise<void>;
}

export type DocumentObjectUrlApi = Readonly<Pick<typeof URL, "createObjectURL" | "revokeObjectURL">>;

export function replaceDocumentObjectUrl(currentUrl: string | null, file: Blob, api: DocumentObjectUrlApi = URL): string {
  if (currentUrl) api.revokeObjectURL(currentUrl);
  return api.createObjectURL(file);
}

export function revokeDocumentObjectUrl(currentUrl: string | null, api: DocumentObjectUrlApi = URL): void {
  if (currentUrl) api.revokeObjectURL(currentUrl);
}

export type DocumentShareNavigator = Readonly<Pick<Navigator, "share" | "canShare">>;

export function canShareBalloonDocument(navigatorApi: Partial<DocumentShareNavigator>, data: ShareData): navigatorApi is DocumentShareNavigator {
  return typeof navigatorApi.share === "function" && typeof navigatorApi.canShare === "function" && navigatorApi.canShare(data);
}
