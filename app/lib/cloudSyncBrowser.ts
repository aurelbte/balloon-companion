import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalDataScope } from "./auth/dataScope.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { AVIATION_PREFERENCES_STORAGE_KEY, type AviationPreferences } from "./aviation/aviationPreferencesStorage.ts";
import {
  CloudSyncService,
  CloudSyncTransportError,
  type CloudMutationResult,
  type CloudSyncIssue,
  type CloudSyncIssueRepository,
  type CloudSyncPayload,
} from "./cloudSyncService.ts";
import { FAVORITE_LAUNCH_SITES_STORAGE_KEY, type FavoriteLaunchSite } from "./favoriteLaunchSites.ts";
import { FAVORITE_WEATHER_PLACES_STORAGE_KEY, type FavoriteWeatherPlace } from "./favoriteWeatherPlaces.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";
import { normalizePilotProfile } from "./pilotProfile.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import { IndexedDbSyncOutboxStorage, type SyncMutation, type SyncOutboxStorage } from "./syncOutbox.ts";
import { normalizeUnitPreferences, UNIT_PREFERENCES_STORAGE_KEY } from "./unitPreferencesStorage.ts";
import { EMPTY_WEATHER_PREFERENCES, WEATHER_PREFERENCES_STORAGE_KEY, type WeatherPreferences } from "./weatherPreferencesStorage.ts";

const CLOUD_SYNC_ISSUES_STORAGE_KEY = "balloon-companion-cloud-sync-issues-v1";

function readJson(storage: Storage, scope: `USER:${string}`, key: string): unknown {
  const raw = storage.getItem(scopedBusinessStorageKey(scope, key));
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function records<T>(value: unknown, property: string): T[] {
  if (!value || typeof value !== "object") return [];
  const list = (value as Record<string, unknown>)[property];
  return Array.isArray(list) ? list as T[] : [];
}

export class BrowserCloudSyncIssueRepository implements CloudSyncIssueRepository {
  private readonly storage: Storage;
  private readonly scope: `USER:${string}`;
  constructor(storage: Storage, scope: `USER:${string}`) { this.storage = storage; this.scope = scope; }
  async save(issue: CloudSyncIssue): Promise<void> {
    const issues = await this.list();
    const next = [...issues.filter((item) => item.entityType !== issue.entityType || item.entityId !== issue.entityId), issue];
    this.storage.setItem(scopedBusinessStorageKey(this.scope, CLOUD_SYNC_ISSUES_STORAGE_KEY), JSON.stringify(next));
  }
  async remove(entityType: string, entityId: string): Promise<void> {
    const next = (await this.list()).filter((item) => item.entityType !== entityType || item.entityId !== entityId);
    this.storage.setItem(scopedBusinessStorageKey(this.scope, CLOUD_SYNC_ISSUES_STORAGE_KEY), JSON.stringify(next));
  }
  async list(): Promise<readonly CloudSyncIssue[]> {
    const value = readJson(this.storage, this.scope, CLOUD_SYNC_ISSUES_STORAGE_KEY);
    return Array.isArray(value) ? value as CloudSyncIssue[] : [];
  }
}

export class BrowserCloudSyncPayloadProvider {
  private readonly storage: Storage;
  private readonly scope: `USER:${string}`;
  constructor(storage: Storage, scope: `USER:${string}`) { this.storage = storage; this.scope = scope; }

  async build(mutation: SyncMutation): Promise<CloudSyncPayload | null> {
    if (mutation.entityType === "pilot-profile") {
      const profile = normalizePilotProfile(readJson(this.storage, this.scope, PILOT_PROFILE_STORAGE_KEY));
      const completion = readJson(this.storage, this.scope, FLIGHT_COMPLETION_STORAGE_KEY) as {
        openingBalance?: { confirmed?: unknown; ascensions?: unknown; officialDurationMinutes?: unknown };
      } | null;
      const opening = completion?.openingBalance;
      return { serverEntityType: "profile", serverEntityId: "profile", payload: {
        first_name: profile.firstName,
        last_name: profile.lastName,
        license_number: profile.licenseNumber,
        usual_function: profile.usualFunction,
        flight_test_due_date: profile.flightTestDueDateIso || null,
        medical_due_date: profile.medicalDueDateIso || null,
        experience_confirmed: opening?.confirmed === true,
        opening_ascensions: typeof opening?.ascensions === "number" ? opening.ascensions : null,
        opening_official_duration_minutes: typeof opening?.officialDurationMinutes === "number" ? opening.officialDurationMinutes : null,
      } };
    }
    if (mutation.entityType === "unit-preferences") {
      return { serverEntityType: "user_preferences", serverEntityId: "units", payload: {
        schema_version: 1,
        preferences: normalizeUnitPreferences(readJson(this.storage, this.scope, UNIT_PREFERENCES_STORAGE_KEY)),
      } };
    }
    if (mutation.entityType === "weather-preferences") {
      const value = readJson(this.storage, this.scope, WEATHER_PREFERENCES_STORAGE_KEY);
      const candidate = value && typeof value === "object" ? value as Partial<WeatherPreferences> : EMPTY_WEATHER_PREFERENCES;
      return { serverEntityType: "user_preferences", serverEntityId: "weather", payload: { schema_version: 1, preferences: {
        favoriteWeatherLocationId: typeof candidate.favoriteWeatherLocationId === "string" ? candidate.favoriteWeatherLocationId : null,
        weatherModel: typeof candidate.weatherModel === "string" ? candidate.weatherModel : null,
      } } };
    }
    if (mutation.entityType === "aviation-preferences") {
      const value = readJson(this.storage, this.scope, AVIATION_PREFERENCES_STORAGE_KEY) as Partial<AviationPreferences> | null;
      return { serverEntityType: "aviation_preferences", serverEntityId: "aviation", payload: {
        airport_icao: typeof value?.airportIcao === "string" ? value.airportIcao : null,
        favorites: Array.isArray(value?.favorites) ? value.favorites : [],
        schema_version: 1,
      } };
    }
    if (mutation.entityType === "favorite-launch-site") {
      const favorite = records<FavoriteLaunchSite>(readJson(this.storage, this.scope, FAVORITE_LAUNCH_SITES_STORAGE_KEY), "favorites")
        .find(({ id }) => id === mutation.entityId);
      return { serverEntityType: "favorite_launch_site", serverEntityId: mutation.entityId, payload: favorite ? {
        sync_id: favorite.syncId ?? null,
        name: favorite.name,
        source_name: favorite.sourceName ?? null,
        latitude: favorite.latitude,
        longitude: favorite.longitude,
        icao_code: favorite.icaoCode ?? null,
        altitude_amsl_m: favorite.altitudeAmslM ?? null,
      } : {} };
    }
    if (mutation.entityType === "favorite-weather-place") {
      const favorite = records<FavoriteWeatherPlace>(readJson(this.storage, this.scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), "favorites")
        .find(({ id }) => id === mutation.entityId);
      return { serverEntityType: "favorite_weather_place", serverEntityId: mutation.entityId, payload: favorite ? {
        sync_id: favorite.syncId ?? null,
        name: favorite.name,
        latitude: favorite.latitude,
        longitude: favorite.longitude,
      } : {} };
    }
    return null;
  }
}

type RpcRow = Readonly<{
  status?: unknown;
  entity_id?: unknown;
  revision?: unknown;
  server_updated_at?: unknown;
  deleted_at?: unknown;
}>;

function mutationResult(value: unknown): CloudMutationResult {
  const row = (Array.isArray(value) ? value[0] : value) as RpcRow | null;
  if (!row || !["APPLIED", "ALREADY_APPLIED", "CONFLICT", "NOT_FOUND"].includes(String(row.status))) {
    throw new CloudSyncTransportError("SERVER", "Invalid mutation response");
  }
  return {
    status: row.status as CloudMutationResult["status"],
    entityId: typeof row.entity_id === "string" ? row.entity_id : "",
    revision: typeof row.revision === "number" ? row.revision : null,
    serverUpdatedAt: typeof row.server_updated_at === "string" ? row.server_updated_at : null,
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

export function createBrowserCloudSyncService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
  getScope(): LocalDataScope | null;
}>): CloudSyncService {
  const payloads = new BrowserCloudSyncPayloadProvider(input.storage, input.scope);
  return new CloudSyncService({
    outbox: new IndexedDbSyncOutboxStorage(input.scope),
    issues: new BrowserCloudSyncIssueRepository(input.storage, input.scope),
    getScope: input.getScope,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      return error ? null : data.user?.id ?? null;
    },
    buildPayload: (mutation) => payloads.build(mutation),
    applyMutation: async (request) => {
      const { data, error } = await input.client.rpc("apply_cloud_sync_mutation", {
        p_mutation_id: request.mutationId,
        p_entity_type: request.entityType,
        p_entity_id: request.entityId,
        p_operation: request.operation,
        p_base_revision: request.baseRevision,
        p_payload: request.payload,
      });
      if (error) {
        const code = String(error.code ?? "");
        const authError = code === "PGRST301" || /jwt|auth|permission/i.test(error.message);
        throw new CloudSyncTransportError(authError ? "AUTH" : "SERVER", error.message);
      }
      return mutationResult(data);
    },
  });
}

export type InitialCloudSyncCandidate = Readonly<{
  entityType: string;
  entityId: string;
  alreadyKnownLocally: boolean;
}>;

/** Read-only and idempotent: inventories local 3A data without enqueueing or uploading it. */
export async function scanInitialCloudSyncInventory(input: Readonly<{
  storage: Storage;
  scope: `USER:${string}`;
  outbox?: Pick<SyncOutboxStorage, "getMetadata">;
}>): Promise<readonly InitialCloudSyncCandidate[]> {
  const outbox = input.outbox ?? new IndexedDbSyncOutboxStorage(input.scope);
  const candidates: Array<{ entityType: string; entityId: string }> = [];
  for (const [entityType, key] of [
    ["pilot-profile", PILOT_PROFILE_STORAGE_KEY],
    ["unit-preferences", UNIT_PREFERENCES_STORAGE_KEY],
    ["weather-preferences", WEATHER_PREFERENCES_STORAGE_KEY],
    ["aviation-preferences", AVIATION_PREFERENCES_STORAGE_KEY],
  ] as const) {
    if (input.storage.getItem(scopedBusinessStorageKey(input.scope, key)) !== null) candidates.push({ entityType, entityId: "singleton" });
  }
  for (const favorite of records<FavoriteLaunchSite>(readJson(input.storage, input.scope, FAVORITE_LAUNCH_SITES_STORAGE_KEY), "favorites")) {
    candidates.push({ entityType: "favorite-launch-site", entityId: favorite.id });
  }
  for (const favorite of records<FavoriteWeatherPlace>(readJson(input.storage, input.scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), "favorites")) {
    candidates.push({ entityType: "favorite-weather-place", entityId: favorite.id });
  }
  return Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    alreadyKnownLocally: (await outbox.getMetadata(candidate.entityType, candidate.entityId)) !== null,
  })));
}
