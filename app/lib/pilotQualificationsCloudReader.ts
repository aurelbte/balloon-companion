import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyPilotQualificationsState } from "./pilotQualificationsStorage.ts";
import { normalizeQualificationEvent, normalizeQualificationProfile, type PilotQualificationsState } from "./pilotQualifications.ts";

export type PilotQualificationsCloudSnapshot = Readonly<{
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  value: Pick<PilotQualificationsState, "profile" | "events">;
}>;

export async function readPilotQualificationsProfileFromCloud(input: Readonly<{
  client: SupabaseClient;
  userId: string;
}>): Promise<PilotQualificationsCloudSnapshot> {
  const { data: authData, error: authError } = await input.client.auth.getUser();
  if (authError || authData.user?.id !== input.userId) throw new Error("QUALIFICATION_CLOUD_AUTH_UNAVAILABLE");
  const { data, error } = await input.client.from("user_preferences")
    .select("id,user_id,preferences,revision,updated_at,deleted_at")
    .eq("id", "qualifications")
    .maybeSingle();
  if (error) throw new Error(`QUALIFICATION_CLOUD_READ_FAILED:${error.code ?? "UNKNOWN"}`);
  if (!data) {
    const empty = createEmptyPilotQualificationsState();
    return { revision: 0, updatedAt: new Date(0).toISOString(), deletedAt: null, value: { profile: empty.profile, events: empty.events } };
  }
  if (data.id !== "qualifications" || data.user_id !== input.userId || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.updated_at !== "string" || (data.deleted_at !== null && typeof data.deleted_at !== "string")) throw new Error("INVALID_QUALIFICATION_CLOUD_ROW");
  if (data.deleted_at) {
    const empty = createEmptyPilotQualificationsState();
    return { revision: data.revision, updatedAt: data.updated_at, deletedAt: data.deleted_at, value: { profile: empty.profile, events: empty.events } };
  }
  if (!data.preferences || typeof data.preferences !== "object" || Array.isArray(data.preferences)) throw new Error("INVALID_QUALIFICATION_CLOUD_ROW");
  const preferences = data.preferences as Record<string, unknown>;
  return {
    revision: data.revision,
    updatedAt: data.updated_at,
    deletedAt: null,
    value: {
      profile: normalizeQualificationProfile(preferences.profile),
      events: Array.isArray(preferences.events) ? preferences.events.map(normalizeQualificationEvent).filter(event => event !== null) : [],
    },
  };
}
