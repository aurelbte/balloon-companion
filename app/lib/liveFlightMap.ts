import {
  LiveSequenceGate,
  livePositionFreshness,
  validateLiveFlightPayload,
  type LiveFlightPositionPayload,
  type LivePositionFreshness,
} from "./liveFlightSharing.ts";

export type SharedPilotIdentity = Readonly<{
  pilotId: string;
  displayName: string;
  sessionId: string;
}>;

export type SharedPilotMapEntry = SharedPilotIdentity & Readonly<{
  previous: LiveFlightPositionPayload | null;
  current: LiveFlightPositionPayload;
}>;

export type InterpolatedLiveCoordinate = Readonly<{
  latitude: number;
  longitude: number;
  heading: number | null;
}>;

export function sharedPilotInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "?";
  const last = parts.length > 1 ? (Array.from(parts.at(-1) ?? "")[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase("fr-FR");
}

function interpolateHeading(from: number | null, to: number | null, progress: number): number | null {
  if (to === null) return from;
  if (from === null) return to;
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * progress + 360) % 360;
}

export function interpolateLiveCoordinate(
  from: Pick<LiveFlightPositionPayload, "latitude" | "longitude" | "heading">,
  to: Pick<LiveFlightPositionPayload, "latitude" | "longitude" | "heading">,
  rawProgress: number,
): InterpolatedLiveCoordinate {
  const progress = Math.min(1, Math.max(0, rawProgress));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * progress,
    longitude: from.longitude + (to.longitude - from.longitude) * progress,
    heading: interpolateHeading(from.heading, to.heading, progress),
  };
}

export function sharedPilotVisibility(payload: LiveFlightPositionPayload, now = Date.now()): Readonly<{
  freshness: LivePositionFreshness;
  visible: boolean;
  dimmed: boolean;
}> {
  const freshness = livePositionFreshness(payload.gpsTimestamp, now);
  return { freshness, visible: freshness !== "EXPIRED", dimmed: freshness === "STALE" };
}

export function relativeLiveAltitudeMeters(
  remote: LiveFlightPositionPayload,
  localAltitude: number | null | undefined,
  localIsFresh: boolean,
  now = Date.now(),
): number | null {
  if (!localIsFresh || livePositionFreshness(remote.gpsTimestamp, now) !== "FRESH") return null;
  if (remote.altitude === null || localAltitude === null || localAltitude === undefined) return null;
  if (!Number.isFinite(remote.altitude) || !Number.isFinite(localAltitude)) return null;
  return Math.round(remote.altitude - localAltitude);
}

export class SharedPilotMapStore {
  private readonly entries = new Map<string, SharedPilotMapEntry>();
  private readonly sequences = new LiveSequenceGate();

  accept(identity: SharedPilotIdentity, rawPayload: unknown, now = Date.now()): boolean {
    const validation = validateLiveFlightPayload(rawPayload, identity.sessionId, now);
    if (!validation.ok || !this.sequences.accept(validation.payload)) return false;
    if (livePositionFreshness(validation.payload.gpsTimestamp, now) === "EXPIRED") return false;
    const existing = this.entries.get(identity.pilotId);
    this.entries.set(identity.pilotId, {
      ...identity,
      previous: existing?.current ?? null,
      current: validation.payload,
    });
    return true;
  }

  removeSession(sessionId: string): void {
    for (const [pilotId, entry] of this.entries) {
      if (entry.sessionId === sessionId) this.entries.delete(pilotId);
    }
    this.sequences.reset(sessionId);
  }

  clearForUserSwitch(): void {
    this.entries.clear();
    this.sequences.reset();
  }

  list(now = Date.now()): SharedPilotMapEntry[] {
    return [...this.entries.values()].filter((entry) => sharedPilotVisibility(entry.current, now).visible);
  }
}
