export const LIVE_PAYLOAD_SCHEMA_VERSION = 1 as const;
export const LIVE_FRESH_MAX_AGE_MS = 15_000;
export const LIVE_STALE_MAX_AGE_MS = 30_000;
export const LIVE_MOVING_SEND_INTERVAL_MS = 5_000;
export const LIVE_STABLE_SEND_INTERVAL_MS = 12_000;
export const LIVE_HEARTBEAT_INTERVAL_MS = 45_000;
export const LIVE_SESSION_TTL_SECONDS = 90;
export const LIVE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

export type LivePositionFreshness = "FRESH" | "STALE" | "EXPIRED";

export type LiveFlightPositionPayload = Readonly<{
  schemaVersion: typeof LIVE_PAYLOAD_SCHEMA_VERSION;
  sessionId: string;
  sequence: number;
  sentAt: number;
  gpsTimestamp: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  durationSeconds: number;
  distanceKm: number;
  accuracy: number | null;
}>;

export type LivePayloadValidation =
  | Readonly<{ ok: true; payload: LiveFlightPositionPayload }>
  | Readonly<{ ok: false; reason: string }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ["schemaVersion", "sessionId", "sequence", "sentAt", "gpsTimestamp", "latitude", "longitude", "altitude", "groundSpeed", "heading", "durationSeconds", "distanceKm", "accuracy"] as const;

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function nullableFinite(value: unknown): value is number | null { return value === null || finite(value); }

export function validateLiveFlightPayload(raw: unknown, expectedSessionId: string, now = Date.now()): LivePayloadValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "INVALID_OBJECT" };
  const value = raw as Record<string, unknown>;
  if (keys.some((key) => !(key in value))) return { ok: false, reason: "INCOMPLETE_PAYLOAD" };
  if (value.schemaVersion !== LIVE_PAYLOAD_SCHEMA_VERSION) return { ok: false, reason: "UNSUPPORTED_SCHEMA" };
  if (typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId) || value.sessionId !== expectedSessionId) return { ok: false, reason: "WRONG_SESSION" };
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return { ok: false, reason: "INVALID_SEQUENCE" };
  if (!finite(value.sentAt) || !finite(value.gpsTimestamp) || value.sentAt > now + 30_000 || value.sentAt < now - 86_400_000 || Math.abs(value.sentAt - value.gpsTimestamp) > 120_000) return { ok: false, reason: "INVALID_TIMESTAMP" };
  if (!finite(value.latitude) || value.latitude < -90 || value.latitude > 90) return { ok: false, reason: "INVALID_LATITUDE" };
  if (!finite(value.longitude) || value.longitude < -180 || value.longitude > 180) return { ok: false, reason: "INVALID_LONGITUDE" };
  if (!nullableFinite(value.altitude) || (value.altitude !== null && (value.altitude < -1_000 || value.altitude > 30_000))) return { ok: false, reason: "INVALID_ALTITUDE" };
  if (!nullableFinite(value.groundSpeed) || (value.groundSpeed !== null && value.groundSpeed < 0)) return { ok: false, reason: "INVALID_GROUND_SPEED" };
  if (!nullableFinite(value.heading) || (value.heading !== null && (value.heading < 0 || value.heading >= 360))) return { ok: false, reason: "INVALID_HEADING" };
  if (!finite(value.durationSeconds) || value.durationSeconds < 0 || !finite(value.distanceKm) || value.distanceKm < 0) return { ok: false, reason: "INVALID_METRICS" };
  if (!nullableFinite(value.accuracy) || (value.accuracy !== null && value.accuracy < 0)) return { ok: false, reason: "INVALID_ACCURACY" };
  return { ok: true, payload: Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as LiveFlightPositionPayload };
}

export class LiveSequenceGate {
  private readonly latestBySession = new Map<string, number>();
  accept(payload: LiveFlightPositionPayload): boolean {
    const latest = this.latestBySession.get(payload.sessionId) ?? 0;
    if (payload.sequence <= latest) return false;
    this.latestBySession.set(payload.sessionId, payload.sequence);
    return true;
  }
  reset(sessionId?: string): void { sessionId ? this.latestBySession.delete(sessionId) : this.latestBySession.clear(); }
}

export function livePositionFreshness(gpsTimestamp: number, now = Date.now()): LivePositionFreshness {
  const age = Math.max(0, now - gpsTimestamp);
  if (age <= LIVE_FRESH_MAX_AGE_MS) return "FRESH";
  if (age <= LIVE_STALE_MAX_AGE_MS) return "STALE";
  return "EXPIRED";
}

export function liveReconnectDelayMs(attempt: number): number {
  return LIVE_RECONNECT_DELAYS_MS[Math.min(Math.max(0, Math.trunc(attempt)), LIVE_RECONNECT_DELAYS_MS.length - 1)];
}

function approximateDistanceMeters(a: Pick<LiveFlightPositionPayload, "latitude" | "longitude">, b: Pick<LiveFlightPositionPayload, "latitude" | "longitude">): number {
  const latitudeMeters = (a.latitude - b.latitude) * 111_320;
  const longitudeMeters = (a.longitude - b.longitude) * 111_320 * Math.cos((b.latitude * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

export function shouldPublishLivePosition(input: Readonly<{
  now: number;
  current: LiveFlightPositionPayload;
  previous: LiveFlightPositionPayload | null;
  force?: boolean;
}>): boolean {
  if (input.force || !input.previous) return true;
  const moving = (input.current.groundSpeed ?? 0) >= 1 || approximateDistanceMeters(input.current, input.previous) >= 10;
  return input.now - input.previous.sentAt >= (moving ? LIVE_MOVING_SEND_INTERVAL_MS : LIVE_STABLE_SEND_INTERVAL_MS);
}

export function buildLiveFlightPayload(input: Omit<LiveFlightPositionPayload, "schemaVersion" | "sequence" | "sentAt"> & { sequence: number; sentAt?: number }): LiveFlightPositionPayload {
  return { schemaVersion: LIVE_PAYLOAD_SCHEMA_VERSION, ...input, sentAt: input.sentAt ?? Date.now() };
}
