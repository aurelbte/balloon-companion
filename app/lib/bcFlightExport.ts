import packageJson from "../../package.json" with { type: "json" };
import type { RecordedFlight } from "./recordedFlight.ts";

export const BCFLIGHT_FORMAT = "BCFLIGHT" as const;
export const BCFLIGHT_FORMAT_VERSION = 1 as const;

export interface BcFlightExport {
  format: typeof BCFLIGHT_FORMAT;
  version: typeof BCFLIGHT_FORMAT_VERSION;
  formatVersion: typeof BCFLIGHT_FORMAT_VERSION;
  exportedAt: string;
  appVersion: string;
  flight: Readonly<{
    id: string;
    status: RecordedFlight["status"];
    startedAt: number;
    endedAt: number | null;
    createdAt: number;
    updatedAt: number;
    startLocationLabel: string | null;
    endLocationLabel: string | null;
    generatedTitle: string | null;
    notes?: string;
  }>;
  recordedTrace: Readonly<{
    schemaVersion: number;
    points: RecordedFlight["points"];
  }>;
  statistics: RecordedFlight["summary"];
  balloon: Readonly<{ registration: string | null }>;
  pilot: null;
  metadata: Readonly<{
    source: "BALLOON_COMPANION_RECORDED_FLIGHT";
    sourceFlightId: string;
    pointCount: number;
    parameters: Readonly<{
      qualityEngine: "GPS_QUALITY_V1";
      statisticsEngine: "GPS_STATISTICS_V1";
      legacyPointsWithoutQuality: "TREATED_AS_VALID";
      statisticsPointQuality: "VALID_ONLY";
      varioWindow: "ADAPTIVE_3_TO_5_SECONDS";
      gapHandling: "SEGMENTS_NOT_CONNECTED";
      thresholds: Readonly<{
        lowAccuracyMeters: 50;
        altitudeSpikeMetersPerSecond: 10;
        sustainedAltitudeSeconds: 5;
        speedOutlierMetersPerSecond: 30;
        sustainedSpeedSeconds: 15;
        isolatedPositionJumpMeters: 300;
        immediateReturnMeters: 100;
        headingDeltaDegrees: 150;
        headingSpeedDeltaMetersPerSecond: 10;
        minimumGapMilliseconds: 10000;
        normalIntervalGapMultiplier: 4;
        minimumVarioWindowMilliseconds: 3000;
        maximumVarioWindowMilliseconds: 5000;
      }>;
    }>;
  }>;
}

export function createBcFlightExport(
  flight: RecordedFlight,
  exportedAt = new Date(),
): BcFlightExport {
  return {
    format: BCFLIGHT_FORMAT,
    version: BCFLIGHT_FORMAT_VERSION,
    formatVersion: BCFLIGHT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    appVersion: packageJson.version,
    flight: {
      id: flight.id,
      status: flight.status,
      startedAt: flight.startedAt,
      endedAt: flight.endedAt,
      createdAt: flight.createdAt,
      updatedAt: flight.updatedAt,
      startLocationLabel: flight.startLocationLabel ?? null,
      endLocationLabel: flight.endLocationLabel ?? null,
      generatedTitle: flight.generatedTitle ?? null,
      ...(flight.notes ? { notes: flight.notes } : {}),
    },
    recordedTrace: {
      schemaVersion: flight.schemaVersion,
      points: flight.points.map((point) => ({ ...point })),
    },
    statistics: { ...flight.summary },
    balloon: { registration: flight.balloonRegistration ?? null },
    pilot: null,
    metadata: {
      source: "BALLOON_COMPANION_RECORDED_FLIGHT",
      sourceFlightId: flight.id,
      pointCount: flight.points.length,
      parameters: {
        qualityEngine: "GPS_QUALITY_V1",
        statisticsEngine: "GPS_STATISTICS_V1",
        legacyPointsWithoutQuality: "TREATED_AS_VALID",
        statisticsPointQuality: "VALID_ONLY",
        varioWindow: "ADAPTIVE_3_TO_5_SECONDS",
        gapHandling: "SEGMENTS_NOT_CONNECTED",
        thresholds: {
          lowAccuracyMeters: 50,
          altitudeSpikeMetersPerSecond: 10,
          sustainedAltitudeSeconds: 5,
          speedOutlierMetersPerSecond: 30,
          sustainedSpeedSeconds: 15,
          isolatedPositionJumpMeters: 300,
          immediateReturnMeters: 100,
          headingDeltaDegrees: 150,
          headingSpeedDeltaMetersPerSecond: 10,
          minimumGapMilliseconds: 10_000,
          normalIntervalGapMultiplier: 4,
          minimumVarioWindowMilliseconds: 3_000,
          maximumVarioWindowMilliseconds: 5_000,
        },
      },
    },
  };
}

export function bcFlightFilename(flight: RecordedFlight): string {
  const date = new Date(flight.startedAt);
  const datePart = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const timePart = [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join("-");
  return `${datePart}_${timePart}_Balloon Companion.bcflight`;
}

export function createBcFlightFile(flight: RecordedFlight, exportedAt = new Date()): File {
  const blob = createBcFlightBlob(flight, exportedAt);
  return new File(
    [blob],
    bcFlightFilename(flight),
    { type: blob.type },
  );
}

export function createBcFlightBlob(flight: RecordedFlight, exportedAt = new Date()): Blob {
  return new Blob(
    [JSON.stringify(createBcFlightExport(flight, exportedAt), null, 2)],
    { type: "application/json" },
  );
}

interface BcFlightDownloadLink {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface BcFlightExportEnvironment {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  createDownloadLink(): BcFlightDownloadLink;
  scheduleCleanup(callback: () => void): void;
}

function browserExportEnvironment(): BcFlightExportEnvironment {
  return {
    share: typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined,
    canShare: typeof navigator.canShare === "function" ? navigator.canShare.bind(navigator) : undefined,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createDownloadLink: () => {
      const link = document.createElement("a");
      link.style.display = "none";
      document.body.appendChild(link);
      return link;
    },
    scheduleCleanup: (callback) => window.setTimeout(callback, 1_000),
  };
}

function downloadBcFlightFile(file: File, environment: BcFlightExportEnvironment): void {
  const url = environment.createObjectUrl(file);
  const link = environment.createDownloadLink();
  link.href = url;
  link.download = file.name;
  link.click();
  environment.scheduleCleanup(() => {
    link.remove();
    environment.revokeObjectUrl(url);
  });
}

export async function exportBcFlight(
  flight: RecordedFlight,
  environment: BcFlightExportEnvironment = browserExportEnvironment(),
): Promise<"SHARED" | "DOWNLOADED"> {
  const file = createBcFlightFile(flight);
  const shareData: ShareData = { files: [file], title: "Balloon Companion — Export du vol" };
  try {
    if (environment.share && environment.canShare?.(shareData)) {
      await environment.share(shareData);
      return "SHARED";
    }
  } catch {
    // Safari peut refuser le partage après canShare : le téléchargement reste disponible.
  }
  downloadBcFlightFile(file, environment);
  return "DOWNLOADED";
}
