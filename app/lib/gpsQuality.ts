import type { GeoPoint, GpsAppState } from "../types/flight.ts";

type GpsDebugLogger = (event: string, details: Readonly<Record<string, unknown>>) => void;

export function isGpsDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugGps") === "1"
  );
}

export class GpsQualitySession {
  private readonly debugLog?: GpsDebugLogger;
  private appState: GpsAppState = "FOREGROUND";
  private lastPointTimestamp: number | null = null;
  private lastReceivedAt: number | null = null;
  private lastPoint: GeoPoint | null = null;
  private callbackSequence = 0;
  private resumedAfterBackground = false;
  private awaitingFirstFixAfterResume = false;

  constructor(debugLog?: GpsDebugLogger) {
    this.debugLog = debugLog;
  }

  enteredBackground(eventTimestamp = Date.now()): void {
    this.appState = "BACKGROUND";
    this.debugLog?.("APP_BACKGROUND", {
      eventTimestamp,
      lastPointTimestamp: this.lastPointTimestamp,
    });
  }

  returnedToForeground(eventTimestamp = Date.now()): void {
    if (this.appState !== "BACKGROUND") return;
    this.appState = "RESUME";
    this.resumedAfterBackground = true;
    this.awaitingFirstFixAfterResume = true;
    this.debugLog?.("APP_FOREGROUND", {
      eventTimestamp,
      lastPointTimestamp: this.lastPointTimestamp,
    });
  }

  enrichPoint(point: GeoPoint, receivedAt = Date.now()): GeoPoint {
    const gpsTimestamp = point.timestamp;
    const previous = this.lastPoint;
    const deltaReceivedAtMs = this.lastReceivedAt === null
      ? undefined
      : receivedAt - this.lastReceivedAt;
    const deltaTimeSincePreviousPoint =
      this.lastPointTimestamp === null
        ? undefined
        : gpsTimestamp - this.lastPointTimestamp;
    const sameCoordinatesAsPrevious = previous === null
      ? false
      : point.latitude === previous.latitude && point.longitude === previous.longitude;
    const sameAltitudeAsPrevious = previous === null
      ? false
      : point.altitude === previous.altitude;
    const sameGpsTimestampAsPrevious = previous === null
      ? false
      : gpsTimestamp === previous.timestamp;
    this.callbackSequence += 1;
    const firstFixAfterResume = this.awaitingFirstFixAfterResume;
    const enrichedPoint: GeoPoint = {
      ...point,
      gpsTimestamp,
      receivedAt,
      callbackSequence: this.callbackSequence,
      deliveryLatencyMs: receivedAt - gpsTimestamp,
      sameCoordinatesAsPrevious,
      sameAltitudeAsPrevious,
      sameGpsTimestampAsPrevious,
      ...(deltaTimeSincePreviousPoint === undefined
        ? {}
        : { deltaGpsTimestampMs: deltaTimeSincePreviousPoint }),
      ...(deltaReceivedAtMs === undefined ? {} : { deltaReceivedAtMs }),
      appState: this.appState,
      lastPointTimestamp: gpsTimestamp,
      ...(deltaTimeSincePreviousPoint === undefined
        ? {}
        : { deltaTimeSincePreviousPoint }),
      resumedAfterBackground: this.resumedAfterBackground,
      firstFixAfterResume,
    };

    this.lastPointTimestamp = gpsTimestamp;
    this.lastReceivedAt = receivedAt;
    this.lastPoint = enrichedPoint;
    this.debugLog?.(`CALLBACK #${this.callbackSequence}`, {
      gpsTimestamp,
      receivedAt,
      deliveryLatencyMs: enrichedPoint.deliveryLatencyMs,
      deltaGpsTimestamp: deltaTimeSincePreviousPoint ?? null,
      deltaReceivedAt: deltaReceivedAtMs ?? null,
      sameCoordinates: sameCoordinatesAsPrevious,
      accuracy: point.accuracy,
      speed: point.speed,
      appState: enrichedPoint.appState,
    });
    if (sameCoordinatesAsPrevious) {
      this.debugLog?.("REPEATED_POSITION", {
        callbackSequence: this.callbackSequence,
        gpsTimestamp,
        receivedAt,
      });
    }
    if (sameGpsTimestampAsPrevious && (deltaReceivedAtMs ?? 0) > 0) {
      this.debugLog?.("LATE_DELIVERY", {
        callbackSequence: this.callbackSequence,
        gpsTimestamp,
        receivedAt,
        deliveryLatencyMs: enrichedPoint.deliveryLatencyMs,
      });
    }
    if (firstFixAfterResume) {
      this.debugLog?.("FIRST_FIX_AFTER_RESUME", {
        timestamp: point.timestamp,
        horizontalAccuracy: point.accuracy,
        deltaTimeSincePreviousPoint: deltaTimeSincePreviousPoint ?? null,
      });
      this.awaitingFirstFixAfterResume = false;
      this.appState = "FOREGROUND";
    }
    return enrichedPoint;
  }
}

export function createGpsDebugLogger(): GpsDebugLogger | undefined {
  if (!isGpsDebugEnabled()) return undefined;
  return (event, details) => console.debug(`[GPS quality] ${event}`, details);
}
