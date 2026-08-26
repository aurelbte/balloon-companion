import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { R2FlightTrackBlobProvider } from "./flightTrackBlobProvider.ts";
import { authorizeFlightTrack } from "./flightTrackR2Authorization.ts";

afterEach(() => { delete globalThis.fetch; });

function authorizationClient({ userId = "user-a", row = null, authError = null } = {}) {
  const selected = row ?? { id: "flight-a", user_id: userId, track_generation: 1, object_key: null, storage_provider: null, deleted_at: null };
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: selected, error: null }) };
  return { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: authError }) }, from: () => chain };
}

test("autorisation R2 refuse anonyme, mauvais propriétaire, génération et clé", async () => {
  await assert.rejects(authorizeFlightTrack(authorizationClient({ userId: null }), "flight-a", 1), /AUTH_REQUIRED/);
  await assert.rejects(authorizeFlightTrack(authorizationClient({ row: null }), "../flight", 1), /INVALID_TRACK_REQUEST/);
  await assert.rejects(authorizeFlightTrack(authorizationClient({ row: { id: "flight-a", user_id: "user-b", track_generation: 1 } }), "flight-a", 1), /FLIGHT_NOT_OWNED/);
  await assert.rejects(authorizeFlightTrack(authorizationClient(), "flight-a", 2), /TRACK_GENERATION_MISMATCH/);
  await assert.rejects(authorizeFlightTrack(authorizationClient({ row: { id: "flight-a", user_id: "user-a", track_generation: 1, storage_provider: "R2", object_key: "wrong", deleted_at: null } }), "flight-a", 1), /TRACK_OBJECT_KEY_MISMATCH/);
});

test("autorisation construit la clé R2 exclusivement depuis l'utilisateur authentifié", async () => {
  const target = await authorizeFlightTrack(authorizationClient(), "flight-a", 1);
  assert.deepEqual(target, { userId: "user-a", flightId: "flight-a", generation: 1, objectKey: "users/user-a/flights/flight-a/track-v1.json", storageProvider: null, deletedAt: null });
});

test("provider R2 demande une URL courte puis transfère directement sans secret client", async () => {
  const calls = [];
  const bytes = new Uint8Array([1, 2, 3]);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "/api/cloud/flight-tracks") return new Response(JSON.stringify({ url: "https://signed.example/put", objectKey: "users/user-a/flights/flight-a/track-v1.json", expiresInSeconds: 300 }), { status: 200 });
    return new Response(null, { status: 200 });
  };
  const result = await new R2FlightTrackBlobProvider().upload({ flightId: "flight-a", generation: 1, bytes, checksum: "a".repeat(64) });
  assert.equal(result.objectKey, "users/user-a/flights/flight-a/track-v1.json");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/cloud/flight-tracks");
  assert.equal(JSON.parse(calls[0].init.body).action, "UPLOAD_URL");
  assert.equal(calls[1].url, "https://signed.example/put");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["x-amz-meta-sha256"], "a".repeat(64));
});

test("provider R2 expose les erreurs endpoint 5xx au retry existant", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(new R2FlightTrackBlobProvider().upload({ flightId: "flight-a", generation: 1, bytes: new Uint8Array([1]), checksum: "a".repeat(64) }), /R2_ENDPOINT_503/);
});

test("provider R2 expose un diagnostic PUT sûr sans URL signée ni credentials", async () => {
  globalThis.fetch = async (url) => url === "/api/cloud/flight-tracks"
    ? new Response(JSON.stringify({ url: "https://signed.example/private?X-Amz-Signature=secret", objectKey: "users/user-a/flights/flight-a/track-v1.json", expiresInSeconds: 300, bucket: "flight-tracks", endpoint: "https://account.r2.cloudflarestorage.com" }), { status: 200 })
    : new Response("<Error><Code>AccessDenied</Code><RequestId>request-safe</RequestId></Error>", { status: 403 });
  await assert.rejects(
    new R2FlightTrackBlobProvider().upload({ flightId: "flight-a", generation: 1, bytes: new Uint8Array([1]), checksum: "a".repeat(64) }),
    (error) => {
      assert.equal(error.message, "R2_UPLOAD_403:AccessDenied");
      assert.equal(error.httpStatus, 403);
      assert.equal(error.requestId, "request-safe");
      assert.equal(error.bucket, "flight-tracks");
      assert.equal(error.endpoint, "https://account.r2.cloudflarestorage.com");
      assert.equal(JSON.stringify(error).includes("X-Amz-Signature"), false);
      return true;
    },
  );
});

test("provider R2 conserve une erreur d'URL expirée comme erreur retryable du transport", async () => {
  globalThis.fetch = async (url) => url === "/api/cloud/flight-tracks"
    ? new Response(JSON.stringify({ url: "https://signed.example/expired", objectKey: "users/user-a/flights/flight-a/track-v1.json", expiresInSeconds: 300 }), { status: 200 })
    : new Response(null, { status: 403 });
  await assert.rejects(new R2FlightTrackBlobProvider().download({ flightId: "flight-a", generation: 1, objectKey: "users/user-a/flights/flight-a/track-v1.json" }), /R2_DOWNLOAD_403/);
});

test("configuration et route R2 restent server-only avec URLs cinq minutes et migration non destructive", async () => {
  const fs = await import("node:fs/promises");
  const server = await fs.readFile(new URL("./flightTrackR2Server.ts", import.meta.url), "utf8");
  const route = await fs.readFile(new URL("../api/cloud/flight-tracks/route.ts", import.meta.url), "utf8");
  const env = await fs.readFile(new URL("../../.env.example", import.meta.url), "utf8");
  assert.match(server, /import "server-only"/);
  assert.match(server, /SIGNED_URL_TTL_SECONDS = 300/);
  assert.match(server, /getSignedUrl/);
  assert.match(server, /legacyObjectRetained: true/);
  assert.match(server, /alreadyMigrated: true/);
  assert.match(server, /row\.storage_provider === "R2" && row\.object_key === target\.objectKey/);
  assert.doesNotMatch(server, /\.remove\(/);
  assert.match(server, /replayLegacyFlightTrackToR2/);
  assert.match(server, /safeFlightTrackObjectKey\(target\.userId, target\.flightId, target\.generation\)/);
  assert.match(server, /HeadObjectCommand/);
  assert.match(server, /R2_TRACK_VERIFICATION_FAILED/);
  assert.match(route, /authorizeFlightTrack/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_R2/);
});

test("helpers R2 ciblés restent dans l'API DEV contrôlée et l'inspection est read-only", async () => {
  const runtime = await (await import("node:fs/promises")).readFile(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(runtime, /controlledTestMode/);
  assert.match(runtime, /uploadFlightTrackToR2Targeted:/);
  assert.match(runtime, /inspectFlightTrackR2TargetedState:/);
  assert.match(runtime, /migrateFlightTrackSupabaseToR2Targeted:/);
  assert.match(runtime, /replayFlightTrackSupabaseToR2Targeted:/);
  assert.match(runtime, /restoreFlightTrackFromR2Targeted:/);
  assert.match(runtime, /inspectFlightTrackR2RestoreState:/);
  const inspector = runtime.match(/inspectFlightTrackR2TargetedState:[\s\S]*?migrateLegacyFlightTrackToR2Targeted:/)?.[0] ?? "";
  assert.match(inspector, /\.inspect\(flightId\)/);
  assert.match(inspector, /\.list\(\)/);
  assert.doesNotMatch(inspector, /\.put\(|\.remove\(|\.update\(|\.upload/);
});
