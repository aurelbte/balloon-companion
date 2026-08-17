import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createGpx, createGpxFile, exportGpx, GPX_MIME_TYPE, gpxFilename, gpxTrackName } from "./gpxExport.ts";

function flight() {
  return {
    id: "gpx-flight", schemaVersion: 1, status: "COMPLETED", startedAt: Date.UTC(2026, 7, 16, 17, 48), endedAt: Date.UTC(2026, 7, 16, 18, 48),
    points: [
      { timestamp: Date.UTC(2026, 7, 16, 17, 48), latitude: 50.800123456, longitude: 2.700987654, altitudeMeters: 123.4, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null },
      { latitude: 50.81, longitude: 2.71, altitudeMeters: null, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null },
      { timestamp: Number.NaN, latitude: 50.82, longitude: 2.72, altitudeMeters: Number.NaN, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null },
      { timestamp: 1, latitude: Number.NaN, longitude: 2.73, altitudeMeters: 200, speedMetersPerSecond: null, headingDegrees: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null },
    ],
    summary: { durationSeconds: 3600, distanceMeters: 10000, minAltitudeMeters: 100, maxAltitudeMeters: 200, averageGroundSpeedMetersPerSecond: null, maxGroundSpeedMetersPerSecond: null },
    createdAt: 1, updatedAt: 2,
  };
}

test("génère un GPX 1.1 avec trace, précision, altitude et temps optionnels", () => {
  const source = flight();
  const snapshot = structuredClone(source);
  const xml = createGpx(source, { date: "16 août 2026", departure: "Boeschepe & Nord", arrival: "Le <Doulieu>" });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<gpx version="1\.1" creator="Balloon Companion"/);
  assert.match(xml, /<trk><name>Balloon Companion — 16 août 2026 — Boeschepe &amp; Nord → Le &lt;Doulieu&gt;<\/name><trkseg>/);
  assert.match(xml, /lat="50\.800123456" lon="2\.700987654"/);
  assert.match(xml, /<ele>123\.4<\/ele><time>2026-08-16T17:48:00\.000Z<\/time>/);
  assert.equal((xml.match(/<trkpt /g) ?? []).length, 3);
  assert.equal((xml.match(/<ele>/g) ?? []).length, 1);
  assert.equal((xml.match(/<time>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /NaN|undefined|Invalid Date/);
  assert.deepEqual(source, snapshot);
});

test("produit un nom humain, un filename sûr et le MIME GPX", () => {
  const source = flight();
  const labels = { date: "16 août 2026", departure: "Boëschepe", arrival: "Le Doulieu" };
  assert.equal(gpxTrackName(source, labels), "Balloon Companion — 16 août 2026 — Boëschepe → Le Doulieu");
  assert.equal(gpxFilename(source, labels), "balloon-companion-2026-08-16-boeschepe-le-doulieu.gpx");
  const file = createGpxFile(source, labels);
  assert.equal(file.type, GPX_MIME_TYPE);
  assert.equal(file.name, gpxFilename(source, labels));
});

function environment({ share, canShare = () => false } = {}) {
  const calls = { shared: 0, downloaded: 0, revoked: 0 };
  const link = { href: "", download: "", click: () => { calls.downloaded += 1; }, remove: () => undefined };
  return { calls, value: { share: share ? async (data) => { calls.shared += 1; await share(data); } : undefined, canShare, createObjectUrl: () => "blob:gpx", revokeObjectUrl: () => { calls.revoked += 1; }, createDownloadLink: () => link, scheduleCleanup: (callback) => callback() } };
}

test("partage sur iPhone, ignore l'annulation et télécharge en fallback", async () => {
  const shared = environment({ share: async () => undefined, canShare: () => true });
  assert.equal(await exportGpx(flight(), {}, shared.value), "SHARED");
  assert.equal(shared.calls.downloaded, 0);
  const cancelled = environment({ share: async () => { throw new DOMException("cancel", "AbortError"); }, canShare: () => true });
  assert.equal(await exportGpx(flight(), {}, cancelled.value), "CANCELLED");
  assert.equal(cancelled.calls.downloaded, 0);
  const fallback = environment();
  assert.equal(await exportGpx(flight(), {}, fallback.value), "DOWNLOADED");
  assert.equal(fallback.calls.downloaded, 1);
  assert.equal(fallback.calls.revoked, 1);
});

test("le générateur GPX est entièrement local et compatible avec les anciens points", () => {
  const source = readFileSync(new URL("./gpxExport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|axios/);
  assert.match(createGpx(flight()), /<trkseg>/);
});
