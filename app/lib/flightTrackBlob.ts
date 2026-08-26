import type { RecordedFlight, RecordedFlightPoint } from "./recordedFlight.ts";

export const FLIGHT_TRACK_BLOB_SCHEMA_VERSION = 1;
export const FLIGHT_TRACK_BUCKET = "flight-tracks";
export const MAX_FLIGHT_TRACK_POINTS = 100_000;
export const MAX_FLIGHT_TRACK_BYTES = 50 * 1024 * 1024;

export type FlightTrackBlob = Readonly<{
  schemaVersion: typeof FLIGHT_TRACK_BLOB_SCHEMA_VERSION;
  flightId: string;
  startedAt: number;
  points: RecordedFlightPoint[];
}>;

export function safeFlightTrackObjectKey(userId: string, flightId: string, generation = 1): string {
  const safe = /^[a-zA-Z0-9-]{1,128}$/;
  if (!safe.test(userId) || !safe.test(flightId) || !Number.isInteger(generation) || generation < 1) throw new Error("INVALID_TRACK_OBJECT_IDENTITY");
  return `${userId}/flights/${flightId}/track-v${generation}.json`;
}

export function safeR2FlightTrackObjectKey(userId: string, flightId: string, generation = 1): string {
  const legacy = safeFlightTrackObjectKey(userId, flightId, generation);
  return `users/${legacy}`;
}

function finiteOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validPoint(value: unknown): value is RecordedFlightPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<RecordedFlightPoint>;
  return typeof point.timestamp === "number" && Number.isFinite(point.timestamp) &&
    typeof point.latitude === "number" && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    typeof point.longitude === "number" && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180 &&
    finiteOrNull(point.altitudeMeters) && finiteOrNull(point.speedMetersPerSecond) &&
    finiteOrNull(point.headingDegrees) && finiteOrNull(point.horizontalAccuracyMeters) && finiteOrNull(point.verticalAccuracyMeters);
}

export function createFlightTrackBlob(flight: RecordedFlight): FlightTrackBlob {
  if (!flight.id || flight.points.length === 0 || flight.points.length > MAX_FLIGHT_TRACK_POINTS || !flight.points.every(validPoint)) throw new Error("INVALID_LOCAL_FLIGHT_TRACK");
  return { schemaVersion: FLIGHT_TRACK_BLOB_SCHEMA_VERSION, flightId: flight.id, startedAt: flight.startedAt, points: flight.points.map((point) => ({ ...point })) };
}

export function encodeFlightTrackBlob(value: FlightTrackBlob): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > MAX_FLIGHT_TRACK_BYTES) throw new Error("FLIGHT_TRACK_TOO_LARGE");
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseFlightTrackBlob(bytes: Uint8Array, expectedFlightId: string): FlightTrackBlob {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FLIGHT_TRACK_BYTES) throw new Error("INVALID_TRACK_SIZE");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("INVALID_TRACK_JSON"); }
  if (!value || typeof value !== "object") throw new Error("INVALID_TRACK_OBJECT");
  const blob = value as Partial<FlightTrackBlob>;
  if (blob.schemaVersion !== FLIGHT_TRACK_BLOB_SCHEMA_VERSION) throw new Error("UNSUPPORTED_TRACK_SCHEMA");
  if (blob.flightId !== expectedFlightId) throw new Error("TRACK_FLIGHT_ID_MISMATCH");
  if (typeof blob.startedAt !== "number" || !Number.isFinite(blob.startedAt)) throw new Error("INVALID_TRACK_STARTED_AT");
  if (!Array.isArray(blob.points) || blob.points.length === 0 || blob.points.length > MAX_FLIGHT_TRACK_POINTS || !blob.points.every(validPoint)) throw new Error("INVALID_TRACK_POINTS");
  return blob as FlightTrackBlob;
}
