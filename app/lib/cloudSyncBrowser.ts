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
import { BALLOON_REGISTRY_STORAGE_KEY, type BalloonRegistry } from "./balloonStorage.ts";
import { balloonDisplayName } from "./balloons.ts";
import type { BalloonDocument } from "./balloonDocuments.ts";
import { IndexedDbBalloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";
import { officialAscensionFlightNature, officialAscensionMovementCounts, type FlightCompletionState } from "./flightCompletion.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { normalizePilotProfile } from "./pilotProfile.ts";
import { normalizeQualificationEvent, normalizeQualificationProfile } from "./pilotQualifications.ts";
import { PILOT_QUALIFICATIONS_STORAGE_KEY } from "./pilotQualificationsStorage.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import { IndexedDbSyncOutboxStorage, type SyncMutation, type SyncOutboxStorage } from "./syncOutbox.ts";
import { normalizeUnitPreferences, UNIT_PREFERENCES_STORAGE_KEY } from "./unitPreferencesStorage.ts";
import { EMPTY_WEATHER_PREFERENCES, WEATHER_PREFERENCES_STORAGE_KEY, type WeatherPreferences } from "./weatherPreferencesStorage.ts";

const CLOUD_SYNC_ISSUES_STORAGE_KEY = "balloon-companion-cloud-sync-issues-v1";
export const CLOUD_SYNC_ISSUES_CHANGED_EVENT = "balloon-companion:cloud-sync-issues-changed";

function notifyIssuesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOUD_SYNC_ISSUES_CHANGED_EVENT));
}

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
    notifyIssuesChanged();
  }
  async remove(entityType: string, entityId: string): Promise<void> {
    const next = (await this.list()).filter((item) => item.entityType !== entityType || item.entityId !== entityId);
    this.storage.setItem(scopedBusinessStorageKey(this.scope, CLOUD_SYNC_ISSUES_STORAGE_KEY), JSON.stringify(next));
    notifyIssuesChanged();
  }
  async list(): Promise<readonly CloudSyncIssue[]> {
    const value = readJson(this.storage, this.scope, CLOUD_SYNC_ISSUES_STORAGE_KEY);
    return Array.isArray(value) ? value as CloudSyncIssue[] : [];
  }
}

export class BrowserCloudSyncPayloadProvider {
  private readonly storage: Storage;
  private readonly scope: `USER:${string}`;
  private readonly loadRecordedFlight: (id: string) => Promise<RecordedFlight | null>;
  private readonly loadBalloonDocument: (id: string) => Promise<BalloonDocument | null>;
  constructor(
    storage: Storage,
    scope: `USER:${string}`,
    loadRecordedFlight: (id: string) => Promise<RecordedFlight | null> = (id) => new IndexedDbRecordedFlightStorage().getFlight(id),
    loadBalloonDocument: (id: string) => Promise<BalloonDocument | null> = (id) => new IndexedDbBalloonDocumentStorage().getDocument(id),
  ) { this.storage = storage; this.scope = scope; this.loadRecordedFlight = loadRecordedFlight; this.loadBalloonDocument = loadBalloonDocument; }

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
    if (mutation.entityType === "pilot-qualifications") {
      const value = readJson(this.storage, this.scope, PILOT_QUALIFICATIONS_STORAGE_KEY) as { profile?: unknown; events?: unknown } | null;
      return { serverEntityType: "user_preferences", serverEntityId: "qualifications", payload: { schema_version: 1, preferences: {
        version: 1,
        profile: normalizeQualificationProfile(value?.profile),
        events: Array.isArray(value?.events) ? value.events.map(normalizeQualificationEvent).filter((event) => event !== null) : [],
      } } };
    }
    if (mutation.entityType === "balloon-preferences") {
      const value = readJson(this.storage, this.scope, BALLOON_REGISTRY_STORAGE_KEY) as Partial<BalloonRegistry> | null;
      return { serverEntityType: "user_preferences", serverEntityId: "balloon", payload: { schema_version: 1, preferences: {
        activeBalloonId: typeof value?.activeBalloonId === "string" ? value.activeBalloonId : null,
      } } };
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
    if (mutation.entityType === "balloon") {
      const value = readJson(this.storage, this.scope, BALLOON_REGISTRY_STORAGE_KEY) as Partial<BalloonRegistry> | null;
      const balloon = Array.isArray(value?.balloons) ? value.balloons.find(({ id }) => id === mutation.entityId) : undefined;
      return { serverEntityType: "balloon", serverEntityId: mutation.entityId, payload: balloon ? {
        registration: balloon.registration,
        display_name: balloonDisplayName(balloon),
        manufacturer: balloon.manufacturer,
        model: balloon.model,
        category: balloon.category,
        volume_m3: balloon.volumeM3,
        applicable_mtom_kg: balloon.applicableMtowKg ?? null,
        configuration_limits_confirmed: balloon.configurationLimitsConfirmed,
        color: balloon.color ?? null,
        weights: balloon.weights,
        is_favorite: balloon.isFavorite === true,
        last_used_at: balloon.lastUsedAt ?? null,
      } : {} };
    }
    if (mutation.entityType === "flight") {
      const flight = mutation.operation === "DELETE" ? null : await this.loadRecordedFlight(mutation.entityId);
      const completion = readJson(this.storage, this.scope, FLIGHT_COMPLETION_STORAGE_KEY) as Partial<FlightCompletionState> | null;
      const journal = completion?.journalFlights?.find(({ sourceFlightId, id }) => (sourceFlightId ?? id) === mutation.entityId);
      return { serverEntityType: "flight", serverEntityId: mutation.entityId, payload: flight ? {
        schema_version: flight.schemaVersion,
        status: flight.status,
        started_at: new Date(flight.startedAt).toISOString(),
        ended_at: flight.endedAt === null ? null : new Date(flight.endedAt).toISOString(),
        balloon_id: null,
        balloon_registration: flight.balloonRegistration ?? journal?.balloonRegistration ?? null,
        start_location_label: flight.startLocationLabel ?? journal?.startLocationLabel ?? null,
        end_location_label: flight.endLocationLabel ?? journal?.endLocationLabel ?? null,
        generated_title: flight.generatedTitle ?? journal?.generatedTitle ?? null,
        custom_title: journal?.customTitle ?? null,
        notes: flight.notes ?? journal?.notes ?? null,
        origin: journal?.origin ?? "REAL_GPS",
        logbook_status: journal?.logbookStatus ?? "CARNET_PENDING",
        recovered: journal?.recovered === true,
        summary: flight.summary,
        weather_model: flight.weatherModel ?? null,
        weather_snapshot: flight.weatherSnapshot ?? null,
        ground_calibration: flight.groundCalibration ?? null,
      } : {} };
    }
    if (mutation.entityType === "logbook-entry") {
      const completion = readJson(this.storage, this.scope, FLIGHT_COMPLETION_STORAGE_KEY) as Partial<FlightCompletionState> | null;
      const ascension = completion?.officialAscensions?.find(({ id }) => id === mutation.entityId);
      if (!ascension) return mutation.operation === "DELETE"
        ? { serverEntityType: "logbook_entry", serverEntityId: mutation.entityId, payload: {} }
        : null;
      const movements = officialAscensionMovementCounts(ascension);
      return { serverEntityType: "logbook_entry", serverEntityId: mutation.entityId, payload: {
        flight_id: ascension.sourceFlightId,
        source: ascension.source,
        date_iso: ascension.dateIso,
        balloon_model: ascension.balloonModel,
        balloon_manufacturer: ascension.balloonManufacturer ?? null,
        registration: ascension.registration,
        departure: ascension.departure,
        arrival: ascension.arrival,
        category: ascension.category,
        pilot_function: ascension.pilotFunction,
        night_flight: ascension.nightFlight,
        maximum_altitude_m: ascension.maximumAltitudeM,
        gps_duration_minutes: ascension.gpsDurationMinutes,
        official_duration_minutes: ascension.officialDurationMinutes,
        observations: ascension.observations,
        flight_nature: officialAscensionFlightNature(ascension),
        takeoff_count: movements.takeoffs,
        landing_count: movements.landings,
        instructor: ascension.instructor ?? null,
        examiner: ascension.examiner ?? null,
      } };
    }
    if (mutation.entityType === "balloon-document") {
      const document = mutation.operation === "DELETE" ? null : await this.loadBalloonDocument(mutation.entityId);
      if (!document) return mutation.operation === "DELETE"
        ? { serverEntityType: "document", serverEntityId: mutation.entityId, payload: {} }
        : null;
      return { serverEntityType: "document", serverEntityId: mutation.entityId, payload: {
        balloon_id: document.balloonId,
        category: document.category,
        title: document.title,
        original_filename: document.originalFileName,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        notes: document.notes ?? null,
        issue_date: document.issueDate ?? null,
        expiry_date: document.expiryDate ?? null,
      } };
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
    ["pilot-qualifications", PILOT_QUALIFICATIONS_STORAGE_KEY],
    ["balloon-preferences", BALLOON_REGISTRY_STORAGE_KEY],
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
