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
  return new File(
    [JSON.stringify(createBcFlightExport(flight, exportedAt), null, 2)],
    bcFlightFilename(flight),
    { type: "application/json" },
  );
}

export async function exportBcFlight(flight: RecordedFlight): Promise<"SHARED" | "DOWNLOADED"> {
  const file = createBcFlightFile(flight);
  const shareData: ShareData = { files: [file], title: "Balloon Companion — Export du vol" };
  if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return "SHARED";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "SHARED";
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return "DOWNLOADED";
}
