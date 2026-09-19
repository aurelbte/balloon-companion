import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyQualificationProfile, normalizeQualificationProfile, type QualificationProfile } from "./pilotQualifications.ts";

export async function readPilotQualificationsProfileFromCloud(input: Readonly<{
  client: SupabaseClient;
  userId: string;
}>): Promise<QualificationProfile> {
  const { data: authData, error: authError } = await input.client.auth.getUser();
  if (authError || authData.user?.id !== input.userId) throw new Error("QUALIFICATION_CLOUD_AUTH_UNAVAILABLE");
  const { data, error } = await input.client.from("user_preferences")
    .select("id,user_id,preferences,deleted_at")
    .eq("id", "qualifications")
    .maybeSingle();
  if (error) throw new Error(`QUALIFICATION_CLOUD_READ_FAILED:${error.code ?? "UNKNOWN"}`);
  if (!data || data.deleted_at) return createEmptyQualificationProfile();
  if (data.id !== "qualifications" || data.user_id !== input.userId || !data.preferences || typeof data.preferences !== "object" || Array.isArray(data.preferences)) throw new Error("INVALID_QUALIFICATION_CLOUD_ROW");
  return normalizeQualificationProfile((data.preferences as Record<string, unknown>).profile);
}
