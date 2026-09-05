import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import { applyBalloonFromCloudWithoutEnqueue, loadBalloonRegistry, type CloudBalloon } from "./balloonStorage.ts";
import { balloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { BrowserCloudSyncIssueRepository, BrowserCloudSyncPayloadProvider, createBrowserCloudSyncService } from "./cloudSyncBrowser.ts";
import {
  parseBalloonCloudRow, parseDocumentCloudRow, parseFavoriteLaunchSiteCloudRow,
  parseFavoriteWeatherPlaceCloudRow, parseFlightCloudRow, parseLogbookEntryCloudRow,
} from "./cloudPullBrowser.ts";
import { resolveCrudConflictLocalWins, resolveCrudConflictServerWins, type CrudCloudState, type CrudConflictEntityType, type CrudConflictResolutionDependencies } from "./crudConflictResolution.ts";
import { applyFavoriteLaunchSiteFromCloudWithoutEnqueue } from "./favoriteLaunchSites.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue } from "./favoriteWeatherPlaces.ts";
import { applyOfficialAscensionFromCloudWithoutEnqueue, applyRecordedFlightToJournalFromCloudWithoutEnqueue, hasOfficialAscensionSourceFlightConflict, type CloudFlightJournalMetadata } from "./flightCompletionStorage.ts";
import type { OfficialAscension } from "./flightCompletion.ts";
import { loadPilotQualifications } from "./pilotQualificationsStorage.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { IndexedDbSyncOutboxStorage } from "./syncOutbox.ts";
import type { BalloonDocument } from "./balloonDocuments.ts";

const DOMAIN = {
  "favorite-weather-place": ["favorite_weather_places", "id,user_id,sync_id,name,latitude,longitude,revision,created_at,updated_at,deleted_at", parseFavoriteWeatherPlaceCloudRow],
  "favorite-launch-site": ["favorite_launch_sites", "id,user_id,sync_id,name,source_name,latitude,longitude,icao_code,altitude_amsl_m,revision,created_at,updated_at,deleted_at", parseFavoriteLaunchSiteCloudRow],
  balloon: ["balloons", "id,user_id,revision,created_at,updated_at,deleted_at,registration,display_name,manufacturer,model,category,volume_m3,applicable_mtom_kg,configuration_limits_confirmed,color,weights,is_favorite,last_used_at", parseBalloonCloudRow],
  flight: ["flights", "id,user_id,revision,created_at,updated_at,deleted_at,schema_version,status,started_at,ended_at,balloon_id,balloon_registration,start_location_label,end_location_label,generated_title,custom_title,notes,origin,logbook_status,recovered,summary,weather_model,weather_snapshot,ground_calibration", parseFlightCloudRow],
  "logbook-entry": ["logbook_entries", "id,user_id,revision,created_at,updated_at,deleted_at,flight_id,source,date_iso,balloon_model,balloon_manufacturer,registration,departure,arrival,category,pilot_function,regulatory_role,supervised_by_fi_b,night_flight,maximum_altitude_m,gps_duration_minutes,official_duration_minutes,observations,flight_nature,takeoff_count,landing_count,instructor,examiner", parseLogbookEntryCloudRow],
  "balloon-document": ["documents", "id,user_id,revision,created_at,updated_at,deleted_at,balloon_id,category,title,original_filename,mime_type,size_bytes,notes,issue_date,expiry_date", parseDocumentCloudRow],
} satisfies Record<CrudConflictEntityType, readonly [string, string, (value: unknown) => { id: string; userId: string; revision: number; updatedAt: string; deletedAt: string | null; value?: unknown }] >;

type FlightValue = Readonly<{ flight: RecordedFlight; journal: CloudFlightJournalMetadata }>;

async function applyCloud(scope: `USER:${string}`, storage: Storage, entityType: CrudConflictEntityType, row: ReturnType<(typeof DOMAIN)[CrudConflictEntityType][2]>): Promise<boolean> {
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
  const service = createBrowserCloudSyncService({ client: input.client, storage: input.storage, scope: input.scope, getScope: getRuntimeDataScope });
  const dependencies: CrudConflictResolutionDependencies = {
    outbox, issues, getScope: getRuntimeDataScope,
    getOnlineUserId: async () => { const { data, error } = await input.client.auth.getUser(); return error ? null : data.user?.id ?? null; },
    readCloud: async (entityType, entityId): Promise<CrudCloudState | null> => {
      const [table, select, parse] = DOMAIN[entityType];
      const { data, error } = await input.client.from(table).select(select).eq("id", entityId).maybeSingle();
      if (error) throw new Error(`Cloud conflict read failed: ${error.code ?? "UNKNOWN"}`);
      if (!data) return null;
      const row = parse(data);
      if (row.userId !== input.scope.slice(5) || row.id !== entityId) throw new Error("Cloud conflict scope mismatch");
      return { revision: row.revision, updatedAt: row.updatedAt, deletedAt: row.deletedAt, value: row };
    },
    applyCloudLocally: (entityType, _entityId, cloud) => applyCloud(input.scope, input.storage, entityType, cloud.value as ReturnType<(typeof DOMAIN)[CrudConflictEntityType][2]>),
    buildPayload: (mutation) => payloads.build(mutation),
    syncMutationById: (mutationId) => service.syncMutationById(mutationId),
  };
  return {
    listConflicts: async () => (await issues.list()).filter((issue) => issue.kind === "CONFLICT" && issue.entityType in DOMAIN),
    resolveLocalWins: (entityType: string, entityId: string) => resolveCrudConflictLocalWins(entityType, entityId, dependencies),
    resolveServerWins: (entityType: string, entityId: string) => resolveCrudConflictServerWins(entityType, entityId, dependencies),
  } as const;
}
