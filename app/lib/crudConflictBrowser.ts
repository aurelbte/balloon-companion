import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import { applyBalloonFromCloudWithoutEnqueue, loadBalloonRegistry, type CloudBalloon } from "./balloonStorage.ts";
import { balloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { BrowserCloudSyncIssueRepository, BrowserCloudSyncPayloadProvider, createBrowserCloudSyncService } from "./cloudSyncBrowser.ts";
import {
  parseBalloonCloudRow, parseDocumentCloudRow, parseFavoriteLaunchSiteCloudRow,
  parseFavoriteWeatherPlaceCloudRow, parseFlightCloudRow, parseLogbookEntryCloudRow, parsePilotQualificationsCloudRow,
} from "./cloudPullBrowser.ts";
import { aggregateCrudConflicts, reconcileBlockedFlightMutation, resolveCrudConflictLocalWins, resolveCrudConflictServerWins, type CrudCloudState, type CrudConflictEntityType, type CrudConflictResolutionDependencies } from "./crudConflictResolution.ts";
import { applyFavoriteLaunchSiteFromCloudWithoutEnqueue } from "./favoriteLaunchSites.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue } from "./favoriteWeatherPlaces.ts";
import { applyOfficialAscensionFromCloudWithoutEnqueue, applyRecordedFlightToJournalFromCloudWithoutEnqueue, hasOfficialAscensionSourceFlightConflict, type CloudFlightJournalMetadata } from "./flightCompletionStorage.ts";
import type { OfficialAscension } from "./flightCompletion.ts";
import { applyPilotQualificationsFromCloudWithoutEnqueue, loadPilotQualifications } from "./pilotQualificationsStorage.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { IndexedDbSyncOutboxStorage, SYNC_MUTATIONS_STORE, SYNC_OUTBOX_DB_NAME, type SyncMutation } from "./syncOutbox.ts";
import { readExistingSyncStore, withLocalSyncInspectionTimeout } from "./cloudSyncVerdictBrowser.ts";
import type { BalloonDocument } from "./balloonDocuments.ts";
import { hasLocalStorageSyncIntent } from "./durableSyncIntent.ts";
import { applyUnitPreferencesFromCloudWithoutEnqueue, normalizeUnitPreferences } from "./unitPreferencesStorage.ts";
import { applyWeatherPreferencesFromCloudWithoutEnqueue } from "./weatherPreferencesStorage.ts";
import { applyAviationPreferencesFromCloudWithoutEnqueue } from "./aviation/aviationPreferencesStorage.ts";
import { normalizeAirportIcao } from "./aviation/aviationWeather.ts";
import {
  resolveProtectedPreferenceConflictCloudWins, resolveProtectedPreferenceConflictLocalWins,
  type ProtectedPreferenceCloudState, type ProtectedPreferenceRebaseType,
} from "./protectedPreferenceConflictRebase.ts";

const DOMAIN = {
  "favorite-weather-place": ["favorite_weather_places", "id,user_id,sync_id,name,latitude,longitude,revision,created_at,updated_at,deleted_at", parseFavoriteWeatherPlaceCloudRow],
  "favorite-launch-site": ["favorite_launch_sites", "id,user_id,sync_id,name,source_name,latitude,longitude,icao_code,altitude_amsl_m,revision,created_at,updated_at,deleted_at", parseFavoriteLaunchSiteCloudRow],
  balloon: ["balloons", "id,user_id,revision,created_at,updated_at,deleted_at,registration,display_name,manufacturer,model,category,volume_m3,applicable_mtom_kg,configuration_limits_confirmed,color,weights,is_favorite,last_used_at", parseBalloonCloudRow],
  flight: ["flights", "id,user_id,revision,created_at,updated_at,deleted_at,schema_version,status,started_at,ended_at,balloon_id,balloon_registration,start_location_label,end_location_label,generated_title,custom_title,notes,origin,logbook_status,recovered,summary,weather_model,weather_snapshot,ground_calibration", parseFlightCloudRow],
  "logbook-entry": ["logbook_entries", "id,user_id,revision,created_at,updated_at,deleted_at,flight_id,source,date_iso,balloon_model,balloon_manufacturer,registration,departure,arrival,category,pilot_function,regulatory_role,supervised_by_fi_b,night_flight,maximum_altitude_m,gps_duration_minutes,official_duration_minutes,observations,flight_nature,takeoff_count,landing_count,instructor,examiner", parseLogbookEntryCloudRow],
  "balloon-document": ["documents", "id,user_id,revision,created_at,updated_at,deleted_at,balloon_id,category,title,original_filename,mime_type,size_bytes,notes,issue_date,expiry_date", parseDocumentCloudRow],
  "pilot-qualifications": ["user_preferences", "id,user_id,revision,created_at,updated_at,deleted_at,preferences,schema_version", parsePilotQualificationsCloudRow],
} satisfies Record<CrudConflictEntityType, readonly [string, string, (value: unknown) => { id: string; userId: string; revision: number; updatedAt: string; deletedAt: string | null; value?: unknown }] >;

type FlightValue = Readonly<{ flight: RecordedFlight; journal: CloudFlightJournalMetadata }>;

function protectedPreferenceValue(type: ProtectedPreferenceRebaseType, row: Record<string, unknown>): unknown {
  if (row.schema_version !== 1) throw new Error("Protected preference schema invalid");
  if (type === "weather-preferences") {
    if (!row.preferences || typeof row.preferences !== "object") throw new Error("Weather preferences invalid");
    const value = row.preferences as Record<string, unknown>;
    if ((value.favoriteWeatherLocationId !== null && typeof value.favoriteWeatherLocationId !== "string") || (value.weatherModel !== null && typeof value.weatherModel !== "string")) throw new Error("Weather preferences invalid");
    return { favoriteWeatherLocationId: value.favoriteWeatherLocationId, weatherModel: value.weatherModel };
  }
  if (type === "unit-preferences") {
    if (!row.preferences || typeof row.preferences !== "object") throw new Error("Unit preferences invalid");
    const value = row.preferences as { weather?: Record<string, unknown>; flightInstruments?: Record<string, unknown> };
    if (!value.weather || !value.flightInstruments || !["km/h", "kt"].includes(String(value.weather.windSpeedUnit)) || !["°C", "°F"].includes(String(value.weather.temperatureUnit)) || !["km/h", "kt"].includes(String(value.flightInstruments.speedUnit)) || !["m", "ft"].includes(String(value.flightInstruments.altitudeUnit)) || !["km", "NM"].includes(String(value.flightInstruments.distanceUnit))) throw new Error("Unit preferences invalid");
    return normalizeUnitPreferences(value);
  }
  if (row.airport_icao !== null && typeof row.airport_icao !== "string" || !Array.isArray(row.favorites)) throw new Error("Aviation preferences invalid");
  const airportIcao = normalizeAirportIcao(row.airport_icao as string | null) ?? null;
  const favorites = row.favorites.map(item => {
    if (!item || typeof item !== "object") throw new Error("Aviation preferences invalid");
    const candidate = item as Record<string, unknown>, icao = normalizeAirportIcao(typeof candidate.icao === "string" ? candidate.icao : null);
    if (!icao || typeof candidate.name !== "string" || !candidate.name.trim()) throw new Error("Aviation preferences invalid");
    return { icao, name: candidate.name.trim() };
  }).filter((item, index, all) => all.findIndex(candidate => candidate.icao === item.icao) === index);
  return { airportIcao, favorites };
}

async function applyCloud(scope: `USER:${string}`, storage: Storage, entityType: CrudConflictEntityType, row: ReturnType<(typeof DOMAIN)[CrudConflictEntityType][2]>): Promise<boolean> {
  if (entityType === "pilot-qualifications") {
    const value = row as ReturnType<typeof parsePilotQualificationsCloudRow>;
    return applyPilotQualificationsFromCloudWithoutEnqueue(scope, value.value, Boolean(value.deletedAt), storage);
  }
  if (entityType === "favorite-weather-place") {
    const value = row as unknown as ReturnType<typeof parseFavoriteWeatherPlaceCloudRow>;
    return applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, { id: value.id, ...(value.syncId ? { syncId: value.syncId } : {}), name: value.name, latitude: value.latitude, longitude: value.longitude, createdAt: value.createdAt, updatedAt: value.updatedAt, deletedAt: value.deletedAt }, storage);
  }
  if (entityType === "favorite-launch-site") {
    const value = row as ReturnType<typeof parseFavoriteLaunchSiteCloudRow>;
    return applyFavoriteLaunchSiteFromCloudWithoutEnqueue(scope, { id: value.id, ...(value.syncId ? { syncId: value.syncId } : {}), name: value.name, ...(value.sourceName ? { sourceName: value.sourceName } : {}), latitude: value.latitude, longitude: value.longitude, ...(value.icaoCode ? { icaoCode: value.icaoCode } : {}), ...(value.altitudeAmslM === null ? {} : { altitudeAmslM: value.altitudeAmslM }), createdAt: value.createdAt, updatedAt: value.updatedAt, deletedAt: value.deletedAt }, storage);
  }
  const rowWithValue = row as typeof row & { value: unknown };
  if (entityType === "balloon") {
    if (row.deletedAt && (await balloonDocumentStorage.countByBalloonId(row.id) > 0 || (loadBalloonRegistry().balloons.find(({ id }) => id === row.id)?.documents.length ?? 0) > 0 || loadPilotQualifications(storage).events.some(({ balloonId }) => balloonId === row.id))) return false;
    return applyBalloonFromCloudWithoutEnqueue(scope, rowWithValue.value as CloudBalloon, storage);
  }
  if (entityType === "flight") {
    const local = rowWithValue.value as FlightValue;
    const flight = row.deletedAt ? null : local.flight;
    if (!await new IndexedDbRecordedFlightStorage().applyFromCloudWithoutEnqueue(scope, row.id, flight)) return false;
    return applyRecordedFlightToJournalFromCloudWithoutEnqueue(scope, row.id, flight, row.deletedAt ? null : local.journal, storage);
  }
  if (entityType === "logbook-entry") {
    const ascension = rowWithValue.value as OfficialAscension;
    if (!row.deletedAt && hasOfficialAscensionSourceFlightConflict(row.id, ascension.sourceFlightId)) return false;
    return applyOfficialAscensionFromCloudWithoutEnqueue(scope, row.id, row.deletedAt ? null : ascension, storage);
  }
  if (row.deletedAt && await balloonDocumentStorage.hasLocalBlob(row.id)) return false;
  return balloonDocumentStorage.applyMetadataFromCloudWithoutEnqueue(scope, row.id, row.deletedAt ? null : rowWithValue.value as BalloonDocument);
}

export function createBrowserCrudConflictResolver(input: Readonly<{ client: SupabaseClient; storage: Storage; scope: `USER:${string}` }>) {
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  const issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope);
  const payloads = new BrowserCloudSyncPayloadProvider(input.storage, input.scope);
  const service = createBrowserCloudSyncService({ client: input.client, storage: input.storage, scope: input.scope, getScope: getRuntimeDataScope, acknowledgeBeforeIssueRemoval: true });
  const dependencies: CrudConflictResolutionDependencies = {
    outbox, issues, getScope: getRuntimeDataScope,
    getOnlineUserId: async () => { const { data, error } = await input.client.auth.getUser(); return error ? null : data.user?.id ?? null; },
    readCloud: async (entityType, entityId): Promise<CrudCloudState | null> => {
      const [table, select, parse] = DOMAIN[entityType];
      const cloudId = entityType === "pilot-qualifications" ? "qualifications" : entityId;
      const { data, error } = await input.client.from(table).select(select).eq("id", cloudId).maybeSingle();
      if (error) throw new Error(`Cloud conflict read failed: ${error.code ?? "UNKNOWN"}`);
      if (!data) return null;
      const row = parse(data);
      const localEntityMatches = entityType === "pilot-qualifications"
        ? (row as ReturnType<typeof parsePilotQualificationsCloudRow>).entityId === entityId
        : row.id === entityId;
      if (row.userId !== input.scope.slice(5) || row.id !== cloudId || !localEntityMatches) throw new Error("Cloud conflict scope mismatch");
      return { revision: row.revision, updatedAt: row.updatedAt, deletedAt: row.deletedAt, value: row };
    },
    applyCloudLocally: (entityType, _entityId, cloud) => applyCloud(input.scope, input.storage, entityType, cloud.value as ReturnType<(typeof DOMAIN)[CrudConflictEntityType][2]>),
    buildPayload: (mutation) => payloads.build(mutation),
    syncMutationById: (mutationId) => service.syncMutationById(mutationId),
  };
  const readProtectedCloud = async (type: ProtectedPreferenceRebaseType): Promise<ProtectedPreferenceCloudState | null> => {
    const { data: authData, error: authError } = await input.client.auth.getUser();
    if (authError || authData.user?.id !== input.scope.slice(5) || getRuntimeDataScope() !== input.scope) throw new Error("Protected preference session mismatch");
    const aviation = type === "aviation-preferences";
    const id = aviation ? "aviation" : type === "weather-preferences" ? "weather" : "units";
    const select = aviation
      ? "id,user_id,revision,updated_at,deleted_at,airport_icao,favorites,schema_version"
      : "id,user_id,revision,updated_at,deleted_at,preferences,schema_version";
    const { data, error } = await input.client.from(aviation ? "aviation_preferences" : "user_preferences").select(select).eq("id", id).maybeSingle();
    if (error) throw new Error(`Protected preference read failed: ${error.code ?? "UNKNOWN"}`);
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;
    if (row.id !== id || row.user_id !== input.scope.slice(5) || !Number.isInteger(row.revision) || typeof row.updated_at !== "string" || (row.deleted_at !== null && typeof row.deleted_at !== "string")) throw new Error("Protected preference cloud row invalid");
    const value = protectedPreferenceValue(type, row);
    const payload = aviation
      ? { serverEntityType: "aviation_preferences", serverEntityId: "aviation", payload: { airport_icao: (value as { airportIcao: string | null }).airportIcao, favorites: (value as { favorites: unknown[] }).favorites, schema_version: 1 } }
      : { serverEntityType: "user_preferences", serverEntityId: id, payload: { schema_version: 1, preferences: value } };
    return { revision: row.revision as number, updatedAt: row.updated_at, deletedAt: row.deleted_at as string | null, value, payload };
  };
  const protectedDependencies = {
    outbox, issues, getScope: getRuntimeDataScope,
    hasPendingIntent: (type: ProtectedPreferenceRebaseType) => hasLocalStorageSyncIntent(input.storage, input.scope, type, "singleton"),
    readCloudState: readProtectedCloud,
    buildPayload: (mutation: SyncMutation) => payloads.build(mutation),
    applyCloudLocally: (type: ProtectedPreferenceRebaseType, cloud: ProtectedPreferenceCloudState) => type === "unit-preferences"
      ? applyUnitPreferencesFromCloudWithoutEnqueue(input.scope, cloud.value, false, input.storage)
      : type === "weather-preferences"
        ? applyWeatherPreferencesFromCloudWithoutEnqueue(input.scope, cloud.value, false, input.storage)
        : applyAviationPreferencesFromCloudWithoutEnqueue(input.scope, cloud.value, false, input.storage),
    syncMutationById: (mutationId: string) => service.syncMutationById(mutationId),
  };
  return {
    listConflicts: async () => aggregateCrudConflicts(await issues.list(), await outbox.list()),
    retryDuplicateRegistration: (entityId: string) => service.retryDuplicateRegistration(entityId),
    resolveLocalWins: (entityType: string, entityId: string) => resolveCrudConflictLocalWins(entityType, entityId, dependencies),
    resolveServerWins: (entityType: string, entityId: string) => resolveCrudConflictServerWins(entityType, entityId, dependencies),
    reconcileBlockedFlight: (entityId: string) => reconcileBlockedFlightMutation(entityId, dependencies),
    resolveProtectedLocalWins: (entityType: string) => resolveProtectedPreferenceConflictLocalWins(entityType, protectedDependencies),
    resolveProtectedCloudWins: (entityType: string) => resolveProtectedPreferenceConflictCloudWins(entityType, protectedDependencies),
  } as const;
}

function abbreviated(value: string | null): string | null {
  if (!value || value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Development-only caller owns exposure; this reader never writes or returns payloads. */
export async function getCloudSyncConflictDebugInfo(storage: Storage, scope: `USER:${string}`) {
  if (!indexedDB.databases) throw new Error("DATABASE_ENUMERATION_UNAVAILABLE");
  const names = await withLocalSyncInspectionTimeout(indexedDB.databases());
  const mutations = await readExistingSyncStore(indexedDB, names, scopedIndexedDbName(scope, SYNC_OUTBOX_DB_NAME), SYNC_MUTATIONS_STORE);
  const conflicts = aggregateCrudConflicts(
    await new BrowserCloudSyncIssueRepository(storage, scope).list(),
    mutations as unknown as SyncMutation[],
  );
  return conflicts.map(conflict => ({
    kind: conflict.kind,
    ...(conflict.businessCode ? { businessCode: conflict.businessCode } : {}),
    entityType: conflict.entityType,
    entityId: abbreviated(conflict.entityId),
    mutationId: abbreviated(conflict.mutationId),
    operation: conflict.operation,
    createdAt: conflict.createdAt,
    recordedAt: conflict.recordedAt,
    attempts: conflict.attempts,
    lastErrorCode: conflict.lastErrorCode,
    integrity: conflict.integrity,
  }));
}
