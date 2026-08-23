import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import { BrowserCloudSyncIssueRepository } from "./cloudSyncBrowser.ts";
import {
  CloudPullService,
  type BalloonCloudRow,
  type FavoriteWeatherPlaceCloudRow,
  type FavoriteWeatherPlacePullConflict,
  type PreferenceCloudRow,
  type PreferencePullDomain,
} from "./cloudPullService.ts";
import { applyBalloonFromCloudWithoutEnqueue, loadBalloonRegistry, type CloudBalloon } from "./balloonStorage.ts";
import { balloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { loadPilotQualifications } from "./pilotQualificationsStorage.ts";
import { BrowserCloudPullCursorRepository, type CloudPullCursor } from "./cloudPullState.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue } from "./favoriteWeatherPlaces.ts";
import { IndexedDbSyncOutboxStorage, type SyncMutation } from "./syncOutbox.ts";
import { applyUnitPreferencesFromCloudWithoutEnqueue } from "./unitPreferencesStorage.ts";
import { applyWeatherPreferencesFromCloudWithoutEnqueue } from "./weatherPreferencesStorage.ts";
import { applyAviationPreferencesFromCloudWithoutEnqueue } from "./aviation/aviationPreferencesStorage.ts";

function quotedPostgrestValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function cloudRow(value: unknown): FavoriteWeatherPlaceCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid favorite weather place cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.name !== "string"
    || typeof row.latitude !== "number" || typeof row.longitude !== "number" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || (row.sync_id !== null && typeof row.sync_id !== "string")) {
    throw new Error("Invalid favorite weather place cloud row");
  }
  return {
    id: row.id,
    userId: row.user_id,
    syncId: row.sync_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function preferenceRow(value: unknown, domain: PreferencePullDomain): PreferenceCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid preference cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")) throw new Error("Invalid preference cloud row");
  const valueForLocal = domain === "aviation-preferences"
    ? { airportIcao: typeof row.airport_icao === "string" ? row.airport_icao : null, favorites: Array.isArray(row.favorites) ? row.favorites : [] }
    : row.preferences;
  return { id: row.id, entityId: "singleton", userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: valueForLocal };
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function balloonRow(value: unknown): BalloonCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid balloon cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.registration !== "string"
    || typeof row.manufacturer !== "string" || typeof row.model !== "string" || typeof row.revision !== "number"
    || typeof row.volume_m3 !== "number" || typeof row.configuration_limits_confirmed !== "boolean"
    || typeof row.is_favorite !== "boolean" || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || !["Libre à air chaud", "Libre à gaz"].includes(String(row.category))
    || !row.weights || typeof row.weights !== "object") throw new Error("Invalid balloon cloud row");
  const weights = row.weights as Record<string, unknown>;
  const cylinders = Array.isArray(weights.fullCylinders) ? weights.fullCylinders.filter((item): item is { id: string; label?: string; fullWeightKg: number } => {
    if (!item || typeof item !== "object") return false;
    const cylinder = item as Record<string, unknown>;
    return typeof cylinder.id === "string" && typeof cylinder.fullWeightKg === "number" && Number.isFinite(cylinder.fullWeightKg)
      && (cylinder.label === undefined || typeof cylinder.label === "string");
  }) : [];
  const local: CloudBalloon = {
    id: row.id,
    registration: row.registration,
    manufacturer: row.manufacturer,
    model: row.model,
    category: row.category as CloudBalloon["category"],
    volumeM3: row.volume_m3,
    ...(finiteOptionalNumber(row.applicable_mtom_kg) === undefined ? {} : { applicableMtowKg: finiteOptionalNumber(row.applicable_mtom_kg) }),
    configurationLimitsConfirmed: row.configuration_limits_confirmed,
    ...(typeof row.color === "string" && row.color ? { color: row.color } : {}),
    ...(row.is_favorite ? { isFavorite: true } : {}),
    ...(typeof row.last_used_at === "string" ? { lastUsedAt: row.last_used_at } : {}),
    weights: {
      ...(finiteOptionalNumber(weights.envelopeKg) === undefined ? {} : { envelopeKg: finiteOptionalNumber(weights.envelopeKg) }),
      ...(finiteOptionalNumber(weights.basketKg) === undefined ? {} : { basketKg: finiteOptionalNumber(weights.basketKg) }),
      ...(finiteOptionalNumber(weights.burnerKg) === undefined ? {} : { burnerKg: finiteOptionalNumber(weights.burnerKg) }),
      fullCylinders: cylinders,
    },
    deletedAt: row.deleted_at,
  };
  return { id: row.id, entityId: row.id, userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: local };
}

async function readPreferencePage(input: Readonly<{
  client: SupabaseClient;
  domain: PreferencePullDomain;
  cursor: CloudPullCursor | null;
  limit: number;
}>): Promise<readonly PreferenceCloudRow[]> {
  const aviation = input.domain === "aviation-preferences";
  const table = aviation ? "aviation_preferences" : "user_preferences";
  const id = aviation ? "aviation" : input.domain === "unit-preferences" ? "units" : "weather";
  const select = aviation
    ? "id,user_id,revision,created_at,updated_at,deleted_at,airport_icao,favorites,schema_version"
    : "id,user_id,revision,created_at,updated_at,deleted_at,preferences,schema_version";
  let query = input.client.from(table).select(select).eq("id", id)
    .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(input.limit);
  if (input.cursor) query = query.or(`updated_at.gt.${input.cursor.updatedAt},and(updated_at.eq.${input.cursor.updatedAt},id.gt.${quotedPostgrestValue(input.cursor.id)})`);
  const { data, error } = await query;
  if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
  return (data ?? []).map((row) => preferenceRow(row, input.domain));
}

export function createBrowserFavoriteWeatherPlacePullService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
}>): CloudPullService {
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  const issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope);
  return new CloudPullService({
    scope: input.scope,
    getScope: getRuntimeDataScope,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      if (error) throw new Error("Cloud pull auth unavailable");
      return data.user?.id ?? null;
    },
    outbox,
    cursors: new BrowserCloudPullCursorRepository(input.storage),
    readPage: async (cursor: CloudPullCursor | null, limit: number) => {
      let query = input.client.from("favorite_weather_places")
        .select("id,user_id,sync_id,name,latitude,longitude,revision,created_at,updated_at,deleted_at")
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (cursor) {
        query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
      return (data ?? []).map(cloudRow);
    },
    applyLocally: (row) => applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(input.scope, {
      id: row.id,
      ...(row.syncId ? { syncId: row.syncId } : {}),
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }, input.storage),
    recordConflict: async (conflict: FavoriteWeatherPlacePullConflict, mutation: SyncMutation, row) => {
      await issues.save({
        kind: "CONFLICT",
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        mutation,
        serverRevision: row.revision,
        serverUpdatedAt: row.updatedAt,
        serverDeletedAt: row.deletedAt,
        recordedAt: new Date().toISOString(),
      });
    },
  });
}

export function createBrowserPreferencePullService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
}>): CloudPullService {
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  const issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope);
  const adapter = (domain: PreferencePullDomain) => ({
    readPage: (cursor: CloudPullCursor | null, limit: number) => readPreferencePage({ client: input.client, domain, cursor, limit }),
    applyLocally: (row: PreferenceCloudRow) => domain === "unit-preferences"
      ? applyUnitPreferencesFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage)
      : domain === "weather-preferences"
        ? applyWeatherPreferencesFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage)
        : applyAviationPreferencesFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage),
  });
  return new CloudPullService({
    scope: input.scope,
    getScope: getRuntimeDataScope,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      if (error) throw new Error("Cloud pull auth unavailable");
      return data.user?.id ?? null;
    },
    outbox,
    cursors: new BrowserCloudPullCursorRepository(input.storage),
    readPage: async () => [],
    applyLocally: () => false,
    preferenceDomains: {
      "unit-preferences": adapter("unit-preferences"),
      "weather-preferences": adapter("weather-preferences"),
      "aviation-preferences": adapter("aviation-preferences"),
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}

export function createBrowserBalloonPullService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
}>): CloudPullService {
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  const issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope);
  return new CloudPullService({
    scope: input.scope,
    getScope: getRuntimeDataScope,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      if (error) throw new Error("Cloud pull auth unavailable");
      return data.user?.id ?? null;
    },
    outbox,
    cursors: new BrowserCloudPullCursorRepository(input.storage),
    readPage: async () => [],
    applyLocally: () => false,
    balloonDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("balloons")
          .select("id,user_id,revision,created_at,updated_at,deleted_at,registration,display_name,manufacturer,model,category,volume_m3,applicable_mtom_kg,configuration_limits_confirmed,color,weights,is_favorite,last_used_at")
          .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
        return (data ?? []).map(balloonRow);
      },
      applyLocally: (row) => applyBalloonFromCloudWithoutEnqueue(input.scope, row.value as CloudBalloon, input.storage),
      hasBlockingLocalDependency: async (row) => {
        if (!row.deletedAt) return false;
        if (await balloonDocumentStorage.countByBalloonId(row.entityId) > 0) return true;
        if ((loadBalloonRegistry().balloons.find(({ id }) => id === row.entityId)?.documents.length ?? 0) > 0) return true;
        return loadPilotQualifications(input.storage).events.some(({ balloonId }) => balloonId === row.entityId);
      },
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}
