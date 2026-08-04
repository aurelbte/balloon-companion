import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BALLOON_DOCUMENT_CATEGORIES, BALLOON_DOCUMENT_MAX_SIZE_BYTES, BALLOON_DOCUMENT_PRIMARY_CARDS, balloonDocumentCardHref, balloonDocumentCategoryLabel, canShareBalloonDocument, documentTitleFromFileName, documentsForPrimaryCard, replaceDocumentObjectUrl, revokeDocumentObjectUrl, sortBalloonDocuments, supportedBalloonDocumentMimeType, validateBalloonDocumentFile } from "./balloonDocuments.ts";
import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENT_DB_VERSION, BalloonDocumentStorageError, IndexedDbBalloonDocumentStorage } from "./balloonDocumentStorage.ts";

const categories = ["REGISTRATION_CERTIFICATE", "AIRWORTHINESS_CERTIFICATE", "INSURANCE", "AIRCRAFT_STATION_LICENCE", "FLIGHT_MANUAL", "FLIGHT_MANUAL_SUPPLEMENT", "WEIGHING_SHEET", "INSPECTIONS", "OTHER"];
const document = (id, balloonId, category, updatedAt) => ({ id, balloonId, category, title: id, originalFileName: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 10, createdAt: updatedAt, updatedAt, storageKey: `balloon/${balloonId}/${id}` });

test("le catalogue expose exactement les neuf catégories V1 dans l'ordre produit", () => {
  assert.deepEqual(BALLOON_DOCUMENT_CATEGORIES.map(([category]) => category), categories);
  for (const [category, label] of BALLOON_DOCUMENT_CATEGORIES) assert.equal(balloonDocumentCategoryLabel(category), label);
  assert.equal(balloonDocumentCategoryLabel("INSPECTIONS"), "Contrôles");
});

test("plusieurs contrôles et Autre sont triés sans catégorie vide", () => {
  const sorted = sortBalloonDocuments([
    document("other", "A", "OTHER", "2026-08-03T10:00:00.000Z"),
    document("inspection-old", "A", "INSPECTIONS", "2026-08-01T10:00:00.000Z"),
    document("registration", "A", "REGISTRATION_CERTIFICATE", "2026-07-01T10:00:00.000Z"),
    document("inspection-new", "A", "INSPECTIONS", "2026-08-02T10:00:00.000Z"),
  ]);
  assert.deepEqual(sorted.map(({ id }) => id), ["registration", "inspection-new", "inspection-old", "other"]);
});

test("les huit cartes principales restent visibles dans un ordre stable", () => {
  assert.deepEqual(BALLOON_DOCUMENT_PRIMARY_CARDS.map(({ label }) => label), ["Immatriculation", "CDN", "Assurance", "LSA", "Manuel de vol", "Fiche de pesée", "Contrôles", "Autres"]);
  assert.equal(BALLOON_DOCUMENT_PRIMARY_CARDS.length, 8);
});

test("une carte vide ouvre l'ajout présélectionné, une carte simple le document et une carte multiple sa liste", () => {
  const inspections = BALLOON_DOCUMENT_PRIMARY_CARDS.find(({ id }) => id === "inspections");
  assert.ok(inspections);
  assert.equal(balloonDocumentCardHref("F H", inspections, []), "/more/profile/balloons/F%20H/documents/new?category=INSPECTIONS");
  const first = document("first", "F H", "INSPECTIONS", "2026-08-01T10:00:00.000Z");
  const second = document("second", "F H", "INSPECTIONS", "2026-08-02T10:00:00.000Z");
  assert.equal(balloonDocumentCardHref("F H", inspections, [first]), "/more/profile/balloons/F%20H/documents/first");
  assert.equal(balloonDocumentCardHref("F H", inspections, [first, second]), "/more/profile/balloons/F%20H/documents?group=inspections");
  assert.deepEqual(documentsForPrimaryCard([first, document("foreign", "B", "OTHER", "2026-08-03T10:00:00.000Z")], inspections).map(({ id }) => id), ["first"]);
});

test("PDF, JPEG, PNG et HEIC/HEIF sont acceptés sous 25 Mo", () => {
  for (const [name, type] of [["manuel.pdf", "application/pdf"], ["photo.jpg", "image/jpeg"], ["scan.png", "image/png"], ["photo.heic", "image/heic"], ["photo.heif", "image/heif"]]) assert.equal(validateBalloonDocumentFile({ name, type, size: 1024 }), null);
  assert.match(validateBalloonDocumentFile({ name: "archive.zip", type: "application/zip", size: 1024 }), /format/);
  assert.match(validateBalloonDocumentFile({ name: "manuel.pdf", type: "application/pdf", size: BALLOON_DOCUMENT_MAX_SIZE_BYTES + 1 }), /25 Mo/);
  assert.equal(documentTitleFromFileName("Assurance 2026.pdf"), "Assurance 2026");
  assert.equal(supportedBalloonDocumentMimeType({ name: "scan.PDF", type: "" }), "application/pdf");
});

test("une URL objet précédente et l'URL de consultation sont toujours révoquées", () => {
  const revoked = [];
  const api = { createObjectURL: () => "blob:next", revokeObjectURL: (url) => revoked.push(url) };
  const next = replaceDocumentObjectUrl("blob:previous", new Blob(["pdf"]), api);
  revokeDocumentObjectUrl(next, api);
  assert.equal(next, "blob:next");
  assert.deepEqual(revoked, ["blob:previous", "blob:next"]);
});

test("le partage n'est proposé que si Web Share accepte réellement le fichier", () => {
  const data = { files: [] };
  assert.equal(canShareBalloonDocument({}, data), false);
  assert.equal(canShareBalloonDocument({ share: async () => {}, canShare: () => false }, data), false);
  assert.equal(canShareBalloonDocument({ share: async () => {}, canShare: () => true }, data), true);
});

test("le stockage IndexedDB possède une base dédiée versionnée et refuse un environnement indisponible", async () => {
  assert.equal(BALLOON_DOCUMENT_DB_NAME, "balloon-companion-documents");
  assert.equal(BALLOON_DOCUMENT_DB_VERSION, 1);
  const storage = new IndexedDbBalloonDocumentStorage(undefined);
  await assert.rejects(() => storage.listByBalloonId("F-HLFM"), (error) => error instanceof BalloonDocumentStorageError && error.code === "UNAVAILABLE");
});

test("les stores fichiers et métadonnées sont séparés et les écritures/suppressions sont transactionnelles", () => {
  const source = readFileSync(new URL("./balloonDocumentStorage.ts", import.meta.url), "utf8");
  assert.match(source, /const DOCUMENTS_STORE = "documents"/);
  assert.match(source, /const FILES_STORE = "files"/);
  assert.match(source, /transaction\(\[DOCUMENTS_STORE, FILES_STORE\], "readwrite"\)/);
  assert.doesNotMatch(source, /localStorage|base64|fetch\(/);
});

test("aucune échéance, notification ou statut n'est exposé dans l'interface V1", () => {
  const pages = [
    "../more/profile/balloons/[id]/documents/page.tsx",
    "../more/profile/balloons/[id]/documents/new/page.tsx",
    "../more/profile/balloons/[id]/documents/[documentId]/page.tsx",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(pages, /expiryDate|issueDate|notification|expiré|expire bientôt/i);
  assert.match(pages, /Ajouter un document/);
  assert.match(pages, /text-overflow: ellipsis|documentGridCard/);
  assert.doesNotMatch(pages, /badge.*(green|red)|status.*(green|red)/i);
});

test("la fiche ballon est une synthèse 2 × 2 sans détails techniques redondants", () => {
  const page = readFileSync(new URL("../more/profile/balloons/[id]/page.tsx", import.meta.url), "utf8");
  const documentsCard = readFileSync(new URL("../components/balloons/BalloonDocumentsCard.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../more/More.module.css", import.meta.url), "utf8");
  for (const label of ["Identité", "Masse équipée", "Limites", "Documents"]) assert.match(`${page}\n${documentsCard}`, new RegExp(label, "i"));
  assert.match(page, /calculateBalloonEmptyWeight\(balloon\)/);
  assert.match(page, /fullCylinders\.length/);
  assert.match(page, /configurationLimitsConfirmed \? "Confirmées" : "À confirmer"/);
  assert.match(page, /Modifier le ballon/);
  assert.match(page, /BalloonDocumentsCard/);
  assert.doesNotMatch(page, />Enveloppe<|>Brûleur<|>Nacelle<|Utilisation dans l.application|Poids cumulé/i);
  assert.match(css, /\.balloonSummaryGrid[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.balloonDetailScreen[^}]*overflow-x:\s*clip/);
});

test("la suppression est hors du flux principal de la synthèse", () => {
  const page = readFileSync(new URL("../more/profile/balloons/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /balloonOverflowMenu/);
  assert.match(page, /Supprimer le ballon/);
  assert.doesNotMatch(page, /detailSection/);
});
