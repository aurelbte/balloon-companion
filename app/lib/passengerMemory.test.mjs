import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildPassengerMemoryModel, formatPassengerMemoryDuration, passengerMemoryFilename } from "./passengerMemory.ts";
import { createPassengerMemoryPdf } from "./passengerMemoryPdf.ts";
import { exportPassengerMemory } from "./passengerMemoryExport.ts";

function fixtures() {
  const recordedFlight = {
    id: "memory-flight", schemaVersion: 1, status: "COMPLETED", startedAt: new Date(2026, 7, 16, 19, 48).getTime(), endedAt: new Date(2026, 7, 16, 20, 44).getTime(),
    points: [{ timestamp: 1, latitude: 50.8, longitude: 2.7, altitudeMeters: 100, speedMetersPerSecond: 5, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8 }],
    summary: { durationSeconds: 3384, distanceMeters: 12234, minAltitudeMeters: 100, maxAltitudeMeters: 960, averageGroundSpeedMetersPerSecond: 5, maxGroundSpeedMetersPerSecond: 24 / 3.6 }, createdAt: 1, updatedAt: 2,
  };
  const journalFlight = { id: "memory-flight", departure: "Boëschepe", arrival: "Le Doulieu", date: "16 août 2026", dateIso: "2026-08-16", balloonRegistration: "F-TEST", durationMinutes: 56, distanceKm: 12.2, takeoffTime: "19:48", landingTime: "20:44", maxAltitudeM: 960, maxSpeedKmh: 24, notes: "Privé", statistics: {}, points: [] };
  return { recordedFlight, journalFlight };
}

const metricUnits = { distanceUnit: "km", altitudeUnit: "m", speedUnit: "km/h" };

test("propose la durée GPS arrondie sans persister la personnalisation", () => {
  const { recordedFlight, journalFlight } = fixtures();
  const snapshot = structuredClone(recordedFlight);
  assert.equal(formatPassengerMemoryDuration(recordedFlight.summary.durationSeconds), "56 min");
  assert.equal(formatPassengerMemoryDuration(3600), "1 h");
  assert.equal(formatPassengerMemoryDuration(4500), "1 h 15");
  const model = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, displayedDuration: "45 min", pilot: { firstName: "Aurélien", lastName: "Boitte" } });
  assert.equal(model.displayedDuration, "45 min");
  assert.deepEqual(recordedFlight, snapshot);
});

test("le modèle souvenir contient les données publiques, unités et identité attendues", () => {
  const { recordedFlight, journalFlight } = fixtures();
  const model = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, pilot: { firstName: " Aurélien ", lastName: " Boitte " } });
  assert.deepEqual(model, { date: "16 août 2026", departure: "Boëschepe", arrival: "Le Doulieu", displayedDuration: "56 min", distance: "12.2 km", maximumAltitude: "960 m", maximumSpeed: "24 km/h", pilotName: "Aurélien Boitte" });
  assert.equal("takeoffTime" in model, false);
  assert.equal("landingTime" in model, false);
  assert.equal("notes" in model, false);
  const imperial = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: { distanceUnit: "NM", altitudeUnit: "ft", speedUnit: "kt" }, pilot: null });
  assert.match(imperial.distance, /NM$/);
  assert.match(imperial.maximumAltitude, /ft$/);
  assert.match(imperial.maximumSpeed, /kt$/);
  assert.equal(imperial.pilotName, null);
});

test("le nom PDF est sûr et stable", () => {
  const { recordedFlight, journalFlight } = fixtures();
  assert.equal(passengerMemoryFilename(recordedFlight, journalFlight), "balloon-companion-souvenir-boeschepe-le-doulieu-2026-08-16.pdf");
});

test("le générateur produit exactement une page A4 portrait", async () => {
  const { recordedFlight, journalFlight } = fixtures();
  const model = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, pilot: null });
  const png = new Uint8Array(readFileSync(new URL("../../public/branding/balloon-companion-logo-cockpit.png", import.meta.url)));
  const bytes = await createPassengerMemoryPdf(model, { logoPng: png, mapPng: png });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.01);
  assert.ok(Math.abs(height - 841.89) < 0.01);
  assert.ok(height > width);
  const source = readFileSync(new URL("./passengerMemoryPdf.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /COPILOTE NUMERIQUE|PILOTES DE MONTGOLFIERE/);
});

test("le renderer prévoit un fallback neutre sans inventer de carte", () => {
  const source = readFileSync(new URL("./passengerMemoryMap.ts", import.meta.url), "utf8");
  assert.match(source, /background: "OPENSTREETMAP" \| "NEUTRAL"/);
  assert.match(source, /fond hors ligne/);
  assert.match(source, /© OpenStreetMap contributors/);
});

test("le souvenir charge exclusivement le logo passagers", () => {
  const source = readFileSync(new URL("./passengerMemoryExport.ts", import.meta.url), "utf8");
  assert.match(source, /\/branding\/balloon-companion-logo-passenger\.png/);
  assert.doesNotMatch(source, /\/branding\/balloon-companion-logo-(?:cockpit|account)\.png/);
});

test("le PDF utilise le partage de fichiers et le téléchargement local en fallback", async () => {
  const { recordedFlight, journalFlight } = fixtures();
  const png = new Uint8Array(readFileSync(new URL("../../public/branding/balloon-companion-logo-cockpit.png", import.meta.url)));
  const calls = { shared: 0, downloaded: 0 };
  const link = { href: "", download: "", click: () => { calls.downloaded += 1; }, remove: () => undefined };
  const base = { createObjectUrl: () => "blob:pdf", revokeObjectUrl: () => undefined, createDownloadLink: () => link, scheduleCleanup: (callback) => callback(), loadLogo: async () => png, renderMap: async () => ({ png, background: "NEUTRAL" }) };
  const input = { recordedFlight, journalFlight, units: metricUnits, displayedDuration: "1 h", pilot: null };
  assert.equal(await exportPassengerMemory(input, { ...base, canShare: () => true, share: async (data) => { calls.shared += 1; assert.equal(data.files[0].type, "application/pdf"); } }), "SHARED");
  assert.equal(calls.shared, 1);
  assert.equal(await exportPassengerMemory(input, { ...base, canShare: () => false }), "DOWNLOADED");
  assert.equal(calls.downloaded, 1);
});
