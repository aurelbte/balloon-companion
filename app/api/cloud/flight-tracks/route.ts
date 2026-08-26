import { createServerSupabaseClient } from "../../../lib/supabase/server.ts";
import { authorizeFlightTrack } from "../../../lib/flightTrackR2Authorization.ts";
import { createR2DownloadUrl, createR2UploadUrl, deleteR2Track, migrateLegacyFlightTrackToR2, replayLegacyFlightTrackToR2 } from "../../../lib/flightTrackR2Server.ts";

export const runtime = "nodejs";

function status(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  return /AUTH_REQUIRED/.test(message) ? 401 : /NOT_OWNED/.test(message) ? 404 : /INVALID|MISMATCH|DELETED|REQUIRES|NOT_ON/.test(message) ? 409 : 500;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    const supabase = await createServerSupabaseClient();
    const target = await authorizeFlightTrack(supabase, body.flightId, body.generation);
    if (body.action === "UPLOAD_URL") return Response.json(await createR2UploadUrl(target, { sizeBytes: body.sizeBytes, checksum: body.checksum }, undefined, body.diagnostics === true));
    if (body.action === "DOWNLOAD_URL") return Response.json(await createR2DownloadUrl(target));
    if (body.action === "DELETE") { await deleteR2Track(target); return Response.json({ deleted: true, objectKey: target.objectKey, expiresInSeconds: 0, url: "" }); }
    if (body.action === "MIGRATE_LEGACY") return Response.json(await migrateLegacyFlightTrackToR2(supabase, target));
    if (body.action === "REPLAY_LEGACY") return Response.json(await replayLegacyFlightTrackToR2(supabase, target));
    return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "TRACK_ENDPOINT_FAILED" }, { status: status(error) });
  }
}
