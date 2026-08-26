import type { SupabaseClient } from "@supabase/supabase-js";
import { safeR2FlightTrackObjectKey } from "./flightTrackBlob.ts";

const FLIGHT_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

export type AuthorizedFlightTrack = Readonly<{
  userId: string;
  flightId: string;
  generation: number;
  objectKey: string;
  storageProvider: string | null;
  deletedAt: string | null;
}>;

export async function authorizeFlightTrack(supabase: SupabaseClient, flightId: unknown, generation: unknown): Promise<AuthorizedFlightTrack> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (authError || !userId) throw new Error("AUTH_REQUIRED");
  if (typeof flightId !== "string" || !FLIGHT_ID_PATTERN.test(flightId) || !Number.isInteger(generation) || Number(generation) < 1) throw new Error("INVALID_TRACK_REQUEST");
  const { data, error } = await supabase.from("flights").select("id,user_id,track_generation,object_key,storage_provider,deleted_at").eq("id", flightId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("FLIGHT_OWNERSHIP_READ_FAILED");
  if (!data || data.user_id !== userId) throw new Error("FLIGHT_NOT_OWNED");
  const actualGeneration = Number(data.track_generation ?? 1);
  if (actualGeneration !== generation) throw new Error("TRACK_GENERATION_MISMATCH");
  const objectKey = safeR2FlightTrackObjectKey(userId, flightId, actualGeneration);
  if (data.storage_provider === "R2" && data.object_key !== objectKey) throw new Error("TRACK_OBJECT_KEY_MISMATCH");
  return { userId, flightId, generation: actualGeneration, objectKey, storageProvider: data.storage_provider, deletedAt: data.deleted_at };
}
