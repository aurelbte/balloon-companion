import type { SupabaseClient } from "@supabase/supabase-js";
import { AVIATION_PREFERENCES_STORAGE_KEY } from "./aviation/aviationPreferencesStorage.ts";
import { getRuntimeDataScope, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { BALLOON_REGISTRY_STORAGE_KEY } from "./balloonStorage.ts";
import { IndexedDbBalloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { CloudBackfillService, cloudBackfillKey, type CloudBackfillCandidate } from "./cloudBackfillService.ts";
import { FAVORITE_LAUNCH_SITES_STORAGE_KEY } from "./favoriteLaunchSites.ts";
import { FAVORITE_WEATHER_PLACES_STORAGE_KEY } from "./favoriteWeatherPlaces.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import { PILOT_QUALIFICATIONS_STORAGE_KEY } from "./pilotQualificationsStorage.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { IndexedDbSyncOutboxStorage } from "./syncOutbox.ts";
import { UNIT_PREFERENCES_STORAGE_KEY } from "./unitPreferencesStorage.ts";
import { WEATHER_PREFERENCES_STORAGE_KEY } from "./weatherPreferencesStorage.ts";

type Mapping = Readonly<{ table: string; cloudId: string }>;

function readJson(storage: Storage, scope: `USER:${string}`, key: string): unknown {
  const raw = storage.getItem(scopedBusinessStorageKey(scope, key));
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function ids(value: unknown, property: string): string[] {
  if (!value || typeof value !== "object") return [];
  const records = (value as Record<string, unknown>)[property];
  return Array.isArray(records) ? records.flatMap((record) => record && typeof record === "object" && typeof (record as { id?: unknown }).id === "string" ? [(record as { id: string }).id] : []) : [];
}

function mapping(candidate: CloudBackfillCandidate): Mapping | null {
  if (candidate.entityType === "pilot-profile") return { table: "profiles", cloudId: "profile" };
  if (candidate.entityType === "unit-preferences") return { table: "user_preferences", cloudId: "units" };
  if (candidate.entityType === "weather-preferences") return { table: "user_preferences", cloudId: "weather" };
  if (candidate.entityType === "aviation-preferences") return { table: "aviation_preferences", cloudId: "aviation" };
  if (candidate.entityType === "pilot-qualifications") return { table: "user_preferences", cloudId: "qualifications" };
  if (candidate.entityType === "balloon-preferences") return { table: "user_preferences", cloudId: "balloon" };
  if (candidate.entityType === "favorite-weather-place") return { table: "favorite_weather_places", cloudId: candidate.entityId };
  if (candidate.entityType === "favorite-launch-site") return { table: "favorite_launch_sites", cloudId: candidate.entityId };
  if (candidate.entityType === "balloon") return { table: "balloons", cloudId: candidate.entityId };
  if (candidate.entityType === "flight") return { table: "flights", cloudId: candidate.entityId };
  if (candidate.entityType === "logbook-entry") return { table: "logbook_entries", cloudId: candidate.entityId };
  if (candidate.entityType === "balloon-document") return { table: "documents", cloudId: candidate.entityId };
  return null;
}

export async function listBrowserCloudBackfillCandidates(storage: Storage, scope: `USER:${string}`): Promise<readonly CloudBackfillCandidate[]> {
  const candidates: CloudBackfillCandidate[] = [];
  const completion = readJson(storage, scope, FLIGHT_COMPLETION_STORAGE_KEY);
  for (const [entityType, key] of [
    ["pilot-profile", PILOT_PROFILE_STORAGE_KEY],
    ["unit-preferences", UNIT_PREFERENCES_STORAGE_KEY],
    ["weather-preferences", WEATHER_PREFERENCES_STORAGE_KEY],
    ["aviation-preferences", AVIATION_PREFERENCES_STORAGE_KEY],
    ["pilot-qualifications", PILOT_QUALIFICATIONS_STORAGE_KEY],
  ] as const) {
    const openingBalancePresent = entityType === "pilot-profile" && completion && typeof completion === "object"
      && (completion as { openingBalance?: { confirmed?: unknown } }).openingBalance?.confirmed === true;
    if (storage.getItem(scopedBusinessStorageKey(scope, key)) !== null || openingBalancePresent) candidates.push({ entityType, entityId: "singleton" });
  }
  for (const id of ids(readJson(storage, scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), "favorites")) candidates.push({ entityType: "favorite-weather-place", entityId: id });
  for (const id of ids(readJson(storage, scope, FAVORITE_LAUNCH_SITES_STORAGE_KEY), "favorites")) candidates.push({ entityType: "favorite-launch-site", entityId: id });
  for (const id of ids(readJson(storage, scope, BALLOON_REGISTRY_STORAGE_KEY), "balloons")) candidates.push({ entityType: "balloon", entityId: id });
  const balloonRegistry = readJson(storage, scope, BALLOON_REGISTRY_STORAGE_KEY);
  if (balloonRegistry && typeof balloonRegistry === "object" && typeof (balloonRegistry as { activeBalloonId?: unknown }).activeBalloonId === "string") candidates.push({ entityType: "balloon-preferences", entityId: "singleton" });
  for (const flight of await new IndexedDbRecordedFlightStorage().listFlights()) candidates.push({ entityType: "flight", entityId: flight.id });
  for (const id of ids(completion, "officialAscensions")) candidates.push({ entityType: "logbook-entry", entityId: id });
  for (const document of await new IndexedDbBalloonDocumentStorage().listDocuments()) candidates.push({ entityType: "balloon-document", entityId: document.id });
  return [...new Map(candidates.map((candidate) => [cloudBackfillKey(candidate), candidate])).values()];
}

export function createBrowserCloudBackfillService(input: Readonly<{ client: SupabaseClient; storage: Storage; scope: `USER:${string}` }>): CloudBackfillService {
  const userId = input.scope.slice(5);
  return new CloudBackfillService({
    scope: input.scope,
    getScope: getRuntimeDataScope,
    isOnline: () => typeof navigator !== "undefined" && navigator.onLine,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      return error ? null : data.user?.id ?? null;
    },
    listCandidates: () => listBrowserCloudBackfillCandidates(input.storage, input.scope),
    findExistingCloud: async (candidates) => {
      const existing = new Set<string>();
      const groups = new Map<string, Array<{ candidate: CloudBackfillCandidate; cloudId: string }>>();
      for (const candidate of candidates) {
        const target = mapping(candidate);
        if (!target) continue;
        groups.set(target.table, [...(groups.get(target.table) ?? []), { candidate, cloudId: target.cloudId }]);
      }
      for (const [table, targets] of groups) {
        for (let offset = 0; offset < targets.length; offset += 100) {
          const batch = targets.slice(offset, offset + 100);
          const { data, error } = await input.client.from(table).select("id,revision,updated_at,deleted_at").eq("user_id", userId).in("id", batch.map(({ cloudId }) => cloudId));
          if (error) throw new Error(`BACKFILL_CLOUD_READ:${error.code ?? "UNKNOWN"}`);
          const found = new Set((data ?? []).flatMap((row) => typeof row.id === "string" ? [row.id] : []));
          for (const target of batch) if (found.has(target.cloudId)) existing.add(cloudBackfillKey(target.candidate));
        }
      }
      return existing;
    },
    outbox: new IndexedDbSyncOutboxStorage(input.scope),
  });
}
