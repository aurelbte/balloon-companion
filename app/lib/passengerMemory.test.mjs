import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildPassengerMemoryModel, defaultPassengerMemoryBalloonId, formatPassengerMemoryDuration, passengerMemoryBalloonLabel, passengerMemoryFilename } from "./passengerMemory.ts";
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
  const selectedBalloon = { id: "balloon-stable-id", manufacturer: " Cameron ", model: " Z105 ", registration: " F-HLFM " };
  const model = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, pilot: { firstName: " Aurélien ", lastName: " Boitte " }, selectedBalloon });
  assert.deepEqual(model, { date: "16 août 2026", departure: "Boëschepe", arrival: "Le Doulieu", displayedDuration: "56 min", distance: "12.2 km", maximumAltitude: "960 m · 3 150 ft", maximumSpeed: "24 km/h", pilotName: "Aurélien Boitte", balloon: { id: "balloon-stable-id", name: "Cameron Z105", registration: "F-HLFM", label: "Cameron Z105 · F-HLFM" } });
  assert.equal("takeoffTime" in model, false);
  assert.equal("landingTime" in model, false);
  assert.equal("notes" in model, false);
  const imperial = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: { distanceUnit: "NM", altitudeUnit: "ft", speedUnit: "kt" }, pilot: null });
  assert.match(imperial.distance, /NM$/);
  assert.equal(imperial.maximumAltitude, "960 m · 3 150 ft");
  assert.match(imperial.maximumSpeed, /kt$/);
  assert.equal(imperial.pilotName, null);
  assert.equal(imperial.balloon, null);
  assert.equal(buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, pilot: { firstName: "Aurélien" } }).pilotName, null);
});

test("le choix du ballon utilise son identifiant stable et gère les données partielles", () => {
  const balloons = [
    { id: "stable-a", manufacturer: "Cameron", model: "Z105", registration: "F-HLFM" },
    { id: "stable-b", manufacturer: "Kubicek", model: "BB30Z", registration: "" },
  ];
  const snapshot = structuredClone(balloons);
  assert.equal(passengerMemoryBalloonLabel(balloons[0]), "Cameron Z105 · F-HLFM");
  assert.equal(passengerMemoryBalloonLabel(balloons[1]), "Kubicek BB30Z");
  assert.equal(passengerMemoryBalloonLabel({ id: "registration-only", manufacturer: "", model: "", registration: "F-TEST" }), "F-TEST");
  assert.equal(defaultPassengerMemoryBalloonId([balloons[0]], undefined, null), "stable-a");
  assert.equal(defaultPassengerMemoryBalloonId(balloons, undefined, "stable-b"), "stable-b");
  assert.equal(defaultPassengerMemoryBalloonId(balloons, "fhlfm", "stable-b"), "stable-a");
  assert.equal(defaultPassengerMemoryBalloonId(balloons, undefined, null), "");
  assert.equal(defaultPassengerMemoryBalloonId([], "F-HLFM", null), "");
  assert.deepEqual(balloons, snapshot);
});

test("le dialogue utilise la liste Mes ballons et bloque les états sans sélection", () => {
  const source = readFileSync(new URL("../components/journal/PassengerMemoryDialog.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");
  assert.match(source, /balloons\.map\(\(balloon\)/);
  assert.match(source, /<option key=\{balloon\.id\} value=\{balloon\.id\}/);
  assert.match(source, /defaultPassengerMemoryBalloonId\(balloons, recordedFlightBalloonRegistration, activeBalloonId\)/);
  assert.match(source, /Aucun ballon n’est enregistré/);
  assert.match(source, /\/more\/profile\/balloons/);
  assert.match(detail, /useBalloonRegistryState\(\)/);
  assert.match(detail, /recordedFlightBalloonRegistration=\{passengerMemoryFlight\.balloonRegistration\}/);
  assert.match(detail, /selectedBalloon/);
});

test("le nom PDF est sûr et stable", () => {
  const { recordedFlight, journalFlight } = fixtures();
  assert.equal(passengerMemoryFilename(recordedFlight, journalFlight), "balloon-companion-souvenir-boeschepe-le-doulieu-2026-08-16.pdf");
});

test("le générateur produit exactement une page A4 portrait", async () => {
  const { recordedFlight, journalFlight } = fixtures();
  const model = buildPassengerMemoryModel({ recordedFlight, journalFlight, units: metricUnits, pilot: null });
  const png = new Uint8Array(readFileSync(new URL("../../public/branding/balloon-companion-logo-passenger.png", import.meta.url)));
  const bytes = await createPassengerMemoryPdf(model, { logoPng: png, mapPng: png });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.01);
  assert.ok(Math.abs(height - 841.89) < 0.01);
  assert.ok(height > width);
  const source = readFileSync(new URL("./passengerMemoryPdf.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /COPILOTE NUMERIQUE|PILOTES DE MONTGOLFIERE/);
  assert.match(source, /x: \(A4\[0\] - logoWidth\) \/ 2/);
  assert.match(source, /compactRoute\(page, model\.departure, model\.arrival/);
  assert.match(source, /`Votre vol du \$\{model\.date\}`/);
  assert.doesNotMatch(source, /VOTRE VOL EN MONTGOLFIERE/);
  assert.doesNotMatch(source, /Votre vol en chiffres/);
  assert.match(source, /drawMemoryLabel\("VOTRE BALLON"/);
  assert.match(source, /drawMemoryLabel\("VOTRE PILOTE"/);
  assert.match(source, /model\.balloon\.registration/);
  assert.doesNotMatch(source, /index === 0 \? navy/);
  assert.doesNotMatch(source, /centered\(page, "Balloon Companion"/);
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
  const png = new Uint8Array(readFileSync(new URL("../../public/branding/balloon-companion-logo-passenger.png", import.meta.url)));
  const calls = { shared: 0, downloaded: 0 };
  const link = { href: "", download: "", click: () => { calls.downloaded += 1; }, remove: () => undefined };
  const base = { createObjectUrl: () => "blob:pdf", revokeObjectUrl: () => undefined, createDownloadLink: () => link, scheduleCleanup: (callback) => callback(), loadLogo: async () => png, renderMap: async () => ({ png, background: "NEUTRAL" }) };
  const input = { recordedFlight, journalFlight, units: metricUnits, displayedDuration: "1 h", pilot: null, selectedBalloon: { id: "stable-id", manufacturer: "Cameron", model: "Z105", registration: "F-HLFM" } };
  assert.equal(await exportPassengerMemory(input, { ...base, canShare: () => true, share: async (data) => { calls.shared += 1; assert.equal(data.files[0].type, "application/pdf"); } }), "SHARED");
  assert.equal(calls.shared, 1);
  assert.equal(await exportPassengerMemory(input, { ...base, canShare: () => false }), "DOWNLOADED");
  assert.equal(calls.downloaded, 1);
});
