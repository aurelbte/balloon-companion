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

  enrichPoint(point: GeoPoint): GeoPoint {
    const deltaTimeSincePreviousPoint =
      this.lastPointTimestamp === null
        ? undefined
        : point.timestamp - this.lastPointTimestamp;
    const firstFixAfterResume = this.awaitingFirstFixAfterResume;
    const enrichedPoint: GeoPoint = {
      ...point,
      appState: this.appState,
      lastPointTimestamp: point.timestamp,
      ...(deltaTimeSincePreviousPoint === undefined
        ? {}
        : { deltaTimeSincePreviousPoint }),
      resumedAfterBackground: this.resumedAfterBackground,
      firstFixAfterResume,
    };

    this.lastPointTimestamp = point.timestamp;
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
