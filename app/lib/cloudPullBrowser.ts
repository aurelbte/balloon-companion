import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { BrowserCloudSyncIssueRepository } from "./cloudSyncBrowser.ts";
import {
  CloudPullService,
  CloudPullTechnicalError,
  type BalloonCloudRow,
  type DocumentCloudRow,
  type FavoriteLaunchSiteCloudRow,
  type FavoriteWeatherPlaceCloudRow,
  type FavoriteWeatherPlacePullConflict,
  type FlightCloudRow,
  type LogbookEntryCloudRow,
  type PilotProfileCloudRow,
  type PreferenceCloudRow,
  type PreferencePullDomain,
} from "./cloudPullService.ts";
import { applyActiveBalloonPreferenceFromCloudWithoutEnqueue, applyBalloonFromCloudWithoutEnqueue, loadBalloonRegistry, type CloudBalloon } from "./balloonStorage.ts";
import { balloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { applyPilotQualificationsFromCloudWithoutEnqueue, loadPilotQualifications } from "./pilotQualificationsStorage.ts";
import { BrowserCloudPullCursorRepository, type CloudPullCursor } from "./cloudPullState.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue, FAVORITE_WEATHER_PLACES_STORAGE_KEY } from "./favoriteWeatherPlaces.ts";
import { repairFavoriteWeatherTombstoneIdentityCollision } from "./favoriteWeatherIdentityRepair.ts";
import { recordFavoriteWeatherPullPlan } from "./favoriteWeatherPullDiagnostics.ts";
import { applyFavoriteLaunchSiteFromCloudWithoutEnqueue } from "./favoriteLaunchSites.ts";
import { IndexedDbSyncOutboxStorage, type SyncMutation } from "./syncOutbox.ts";
import { applyUnitPreferencesFromCloudWithoutEnqueue } from "./unitPreferencesStorage.ts";
import { applyWeatherPreferencesFromCloudWithoutEnqueue } from "./weatherPreferencesStorage.ts";
import { applyAviationPreferencesFromCloudWithoutEnqueue } from "./aviation/aviationPreferencesStorage.ts";
import type { RecordedFlight, RecordedFlightSummary } from "./recordedFlight.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { applyOfficialAscensionFromCloudWithoutEnqueue, applyOpeningBalanceFromCloudWithoutEnqueue, applyRecordedFlightToJournalFromCloudWithoutEnqueue, hasOfficialAscensionSourceFlightConflict, type CloudFlightJournalMetadata } from "./flightCompletionStorage.ts";
import { OFFICIAL_FLIGHT_NATURES, type OfficialAscension } from "./flightCompletion.ts";
import { BALLOON_DOCUMENT_CATEGORY_ORDER, type BalloonDocument } from "./balloonDocuments.ts";
import { normalizePilotProfile, type PilotProfile } from "./pilotProfile.ts";
import { applyPilotProfileFromCloudWithoutEnqueue } from "./pilotProfileStorage.ts";

function quotedPostgrestValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function favoriteWeatherPullCursorForLocalState(cursor: CloudPullCursor | null, localFavoriteCount: number): CloudPullCursor | null {
  return localFavoriteCount === 0 ? null : cursor;
}

function localFavoriteWeatherPlaceCount(storage: Storage, scope: `USER:${string}`): number {
  try {
    const value = JSON.parse(storage.getItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY)) ?? "null") as { favorites?: unknown } | null;
    return Array.isArray(value?.favorites) ? value.favorites.length : 0;
  } catch { return 0; }
}

export function parseFavoriteWeatherPlaceCloudRow(value: unknown): FavoriteWeatherPlaceCloudRow {
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

export function parseFavoriteLaunchSiteCloudRow(value: unknown): FavoriteLaunchSiteCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid favorite launch site cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.name !== "string"
    || typeof row.latitude !== "number" || typeof row.longitude !== "number" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || (row.sync_id !== null && typeof row.sync_id !== "string")
    || (row.source_name !== null && typeof row.source_name !== "string")
    || (row.icao_code !== null && typeof row.icao_code !== "string")
    || (row.altitude_amsl_m !== null && typeof row.altitude_amsl_m !== "number")) {
    throw new Error("Invalid favorite launch site cloud row");
  }
  return {
    id: row.id, entityId: row.id, userId: row.user_id, syncId: row.sync_id, name: row.name,
    sourceName: row.source_name, latitude: row.latitude, longitude: row.longitude,
    icaoCode: row.icao_code, altitudeAmslM: row.altitude_amsl_m, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
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

type CloudPilotProfileLocalValue = Readonly<{
  profile: PilotProfile;
  openingBalance: Readonly<{ confirmed: boolean; ascensions: number | null; officialDurationMinutes: number | null }>;
}>;

function pilotProfileRow(value: unknown): PilotProfileCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid pilot profile cloud row");
  const row = value as Record<string, unknown>;
  const nullableString = (key: string) => row[key] === null || typeof row[key] === "string";
  const nullableNonNegativeInteger = (key: string) => row[key] === null
    || typeof row[key] === "number" && Number.isInteger(row[key]) && row[key] >= 0;
  if (row.id !== "profile" || typeof row.user_id !== "string" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || typeof row.first_name !== "string" || typeof row.last_name !== "string" || typeof row.license_number !== "string"
    || !nullableString("usual_function") || !nullableString("flight_test_due_date") || !nullableString("medical_due_date")
    || typeof row.experience_confirmed !== "boolean" || !nullableNonNegativeInteger("opening_ascensions")
    || !nullableNonNegativeInteger("opening_official_duration_minutes")) throw new Error("Invalid pilot profile cloud row");
  const valueForLocal: CloudPilotProfileLocalValue = {
    profile: normalizePilotProfile({
      firstName: row.first_name, lastName: row.last_name, licenseNumber: row.license_number,
      usualFunction: row.usual_function, flightTestDueDateIso: row.flight_test_due_date ?? "",
      medicalDueDateIso: row.medical_due_date ?? "",
    }),
    openingBalance: {
      confirmed: row.experience_confirmed,
      ascensions: row.opening_ascensions as number | null,
      officialDurationMinutes: row.opening_official_duration_minutes as number | null,
    },
  };
  return { id: "profile", entityId: "singleton", userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: valueForLocal };
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseBalloonCloudRow(value: unknown): BalloonCloudRow {
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

type CloudFlightLocalValue = Readonly<{
  flight: RecordedFlight;
  journal: CloudFlightJournalMetadata;
  balloonId: string | null;
}>;

function nullableFiniteNumber(value: unknown): number | null | undefined {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function flightSummary(value: unknown): RecordedFlightSummary {
  if (!value || typeof value !== "object") throw new Error("Invalid flight cloud summary");
  const summary = value as Record<string, unknown>;
  const required = ["durationSeconds", "distanceMeters"] as const;
  const nullable = ["minAltitudeMeters", "maxAltitudeMeters", "averageGroundSpeedMetersPerSecond", "maxGroundSpeedMetersPerSecond"] as const;
  if (required.some((key) => typeof summary[key] !== "number" || !Number.isFinite(summary[key]))
    || nullable.some((key) => nullableFiniteNumber(summary[key]) === undefined)) throw new Error("Invalid flight cloud summary");
  return value as RecordedFlightSummary;
}

export function parseFlightCloudRow(value: unknown): FlightCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid flight cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.revision !== "number"
    || typeof row.schema_version !== "number" || !["RECORDING", "COMPLETED", "INTERRUPTED"].includes(String(row.status))
    || typeof row.started_at !== "string" || (row.ended_at !== null && typeof row.ended_at !== "string")
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || (row.balloon_id !== null && typeof row.balloon_id !== "string")
    || ![null, "REAL_GPS", "MANUAL", "DEMO"].includes(row.origin as null | string)
    || ![null, "CARNET_PENDING", "CARNET_VALIDATED", "JOURNAL_ONLY"].includes(row.logbook_status as null | string)
    || typeof row.recovered !== "boolean") throw new Error("Invalid flight cloud row");
  const startedAt = Date.parse(row.started_at);
  const endedAt = row.ended_at === null ? null : Date.parse(row.ended_at as string);
  const createdAt = Date.parse(row.created_at);
  const updatedAt = Date.parse(row.updated_at);
  if (![startedAt, createdAt, updatedAt, ...(endedAt === null ? [] : [endedAt])].every(Number.isFinite)) throw new Error("Invalid flight cloud dates");
  const optionalText = (field: string) => typeof row[field] === "string" && row[field] ? row[field] as string : undefined;
  const flight: RecordedFlight = {
    id: row.id,
    schemaVersion: row.schema_version,
    status: row.status as RecordedFlight["status"],
    startedAt,
    endedAt,
    points: [],
    summary: flightSummary(row.summary),
    createdAt,
    updatedAt,
    ...(optionalText("balloon_registration") ? { balloonRegistration: optionalText("balloon_registration") } : {}),
    ...(optionalText("start_location_label") ? { startLocationLabel: optionalText("start_location_label") } : {}),
    ...(optionalText("end_location_label") ? { endLocationLabel: optionalText("end_location_label") } : {}),
    ...(optionalText("generated_title") ? { generatedTitle: optionalText("generated_title") } : {}),
    ...(optionalText("notes") ? { notes: optionalText("notes") } : {}),
    ...(optionalText("weather_model") ? { weatherModel: optionalText("weather_model") } : {}),
    ...(row.weather_snapshot && typeof row.weather_snapshot === "object" ? { weatherSnapshot: row.weather_snapshot as RecordedFlight["weatherSnapshot"] } : {}),
    ...(row.ground_calibration && typeof row.ground_calibration === "object" ? { groundCalibration: row.ground_calibration as RecordedFlight["groundCalibration"] } : {}),
  };
  const local: CloudFlightLocalValue = {
    flight,
    journal: {
      customTitle: optionalText("custom_title") ?? null,
      origin: (row.origin ?? "REAL_GPS") as CloudFlightJournalMetadata["origin"],
      logbookStatus: (row.logbook_status ?? "CARNET_PENDING") as CloudFlightJournalMetadata["logbookStatus"],
      recovered: row.recovered,
    },
    balloonId: row.balloon_id as string | null,
  };
  return { id: row.id, entityId: row.id, userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: local };
}

function localizedLogbookDate(dateIso: string): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid logbook entry date");
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function parseLogbookEntryCloudRow(value: unknown): LogbookEntryCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid logbook entry cloud row");
  const row = value as Record<string, unknown>;
  const nullableNumber = (field: string) => row[field] === null || typeof row[field] === "number" && Number.isFinite(row[field]);
  const nullableObject = (field: string) => row[field] === null || Boolean(row[field]) && typeof row[field] === "object" && !Array.isArray(row[field]);
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string")
    || (row.flight_id !== null && typeof row.flight_id !== "string")
    || !["GPS_BALLOON_COMPANION", "MANUAL"].includes(String(row.source))
    || typeof row.date_iso !== "string" || typeof row.balloon_model !== "string"
    || (row.balloon_manufacturer !== null && typeof row.balloon_manufacturer !== "string")
    || typeof row.registration !== "string" || typeof row.departure !== "string" || typeof row.arrival !== "string"
    || !["Libre à air chaud", "Libre à gaz"].includes(String(row.category))
    || !["Pilote", "Élève"].includes(String(row.pilot_function)) || typeof row.night_flight !== "boolean"
    || (row.regulatory_role !== null && !["PIC", "DUAL", "FI_B", "FE_B"].includes(String(row.regulatory_role)))
    || (row.supervised_by_fi_b !== null && typeof row.supervised_by_fi_b !== "boolean")
    || !nullableNumber("maximum_altitude_m") || !nullableNumber("gps_duration_minutes")
    || typeof row.official_duration_minutes !== "number" || !Number.isInteger(row.official_duration_minutes)
    || typeof row.observations !== "string" || !OFFICIAL_FLIGHT_NATURES.includes(row.flight_nature as typeof OFFICIAL_FLIGHT_NATURES[number])
    || typeof row.takeoff_count !== "number" || !Number.isInteger(row.takeoff_count)
    || typeof row.landing_count !== "number" || !Number.isInteger(row.landing_count)
    || !nullableObject("instructor") || !nullableObject("examiner")) throw new Error("Invalid logbook entry cloud row");
  const ascension: OfficialAscension = {
    id: row.id,
    sourceFlightId: row.flight_id as string | null,
    source: row.source as OfficialAscension["source"],
    dateIso: row.date_iso,
    date: localizedLogbookDate(row.date_iso),
    balloonModel: row.balloon_model,
    ...(typeof row.balloon_manufacturer === "string" ? { balloonManufacturer: row.balloon_manufacturer } : {}),
    registration: row.registration,
    departure: row.departure,
    arrival: row.arrival,
    category: row.category as OfficialAscension["category"],
    pilotFunction: row.pilot_function as OfficialAscension["pilotFunction"],
    regulatoryRole: row.regulatory_role as OfficialAscension["regulatoryRole"],
    supervisedByFiB: row.supervised_by_fi_b as OfficialAscension["supervisedByFiB"],
    nightFlight: row.night_flight,
    maximumAltitudeM: row.maximum_altitude_m as number | null,
    gpsDurationMinutes: row.gps_duration_minutes as number | null,
    officialDurationMinutes: row.official_duration_minutes,
    observations: row.observations,
    flightNature: row.flight_nature as OfficialAscension["flightNature"],
    takeoffCount: row.takeoff_count,
    landingCount: row.landing_count,
    ...(row.instructor ? { instructor: row.instructor as NonNullable<OfficialAscension["instructor"]> } : {}),
    ...(row.examiner ? { examiner: row.examiner as NonNullable<OfficialAscension["examiner"]> } : {}),
  };
  return { id: row.id, entityId: row.id, userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: ascension };
}

export function parseDocumentCloudRow(value: unknown): DocumentCloudRow {
  if (!value || typeof value !== "object") throw new Error("Invalid document cloud row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.revision !== "number"
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.deleted_at !== null && typeof row.deleted_at !== "string") || typeof row.balloon_id !== "string"
    || !BALLOON_DOCUMENT_CATEGORY_ORDER.includes(row.category as typeof BALLOON_DOCUMENT_CATEGORY_ORDER[number])
    || typeof row.title !== "string" || typeof row.original_filename !== "string" || typeof row.mime_type !== "string"
    || typeof row.size_bytes !== "number" || !Number.isFinite(row.size_bytes)
    || (row.notes !== null && typeof row.notes !== "string")
    || (row.issue_date !== null && typeof row.issue_date !== "string")
    || (row.expiry_date !== null && typeof row.expiry_date !== "string")) throw new Error("Invalid document cloud row");
  const document: BalloonDocument = {
    id: row.id,
    balloonId: row.balloon_id,
    category: row.category as BalloonDocument["category"],
    title: row.title,
    originalFileName: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
    ...(typeof row.issue_date === "string" ? { issueDate: row.issue_date } : {}),
    ...(typeof row.expiry_date === "string" ? { expiryDate: row.expiry_date } : {}),
  };
  return { id: row.id, entityId: row.id, userId: row.user_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, value: document };
}

async function readPreferencePage(input: Readonly<{
  client: SupabaseClient;
  domain: PreferencePullDomain;
  cursor: CloudPullCursor | null;
  limit: number;
}>): Promise<readonly PreferenceCloudRow[]> {
  const aviation = input.domain === "aviation-preferences";
  const table = aviation ? "aviation_preferences" : "user_preferences";
  const id = aviation ? "aviation"
    : input.domain === "unit-preferences" ? "units"
      : input.domain === "weather-preferences" ? "weather"
        : input.domain === "pilot-qualifications" ? "qualifications"
          : "balloon";
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
  const repairCollision = async (row: FavoriteWeatherPlaceCloudRow, pending: readonly SyncMutation[]) => {
    const result = await repairFavoriteWeatherTombstoneIdentityCollision({ scope: input.scope, storage: input.storage, outbox, row, pending });
    if (result.repaired) await issues.remove("favorite-weather-place", row.id);
    return result.repaired;
  };
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
    prepareIdentityRepairs: async () => { await repairBrowserFavoriteWeatherIdentityCollisions(input, outbox, issues); },
    readPage: async (cursor: CloudPullCursor | null, limit: number) => {
      const localFavoriteCount = localFavoriteWeatherPlaceCount(input.storage, input.scope);
      const effectiveCursor = favoriteWeatherPullCursorForLocalState(cursor, localFavoriteCount);
      recordFavoriteWeatherPullPlan({ inputCursor: cursor, effectiveCursor, localFavoriteCount });
      let query = input.client.from("favorite_weather_places")
        .select("id,user_id,sync_id,name,latitude,longitude,revision,created_at,updated_at,deleted_at")
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (effectiveCursor) {
        query = query.or(`updated_at.gt.${effectiveCursor.updatedAt},and(updated_at.eq.${effectiveCursor.updatedAt},id.gt.${quotedPostgrestValue(effectiveCursor.id)})`);
      }
      const { data, error } = await query;
      if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
      return (data ?? []).map(parseFavoriteWeatherPlaceCloudRow);
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
    repairIdentityCollision: repairCollision,
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

export async function repairBrowserFavoriteWeatherIdentityCollisions(
  input: Readonly<{ client: SupabaseClient; storage: Storage; scope: `USER:${string}` }>,
  outbox = new IndexedDbSyncOutboxStorage(input.scope),
  issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope),
): Promise<number> {
  const pending = (await outbox.list()).filter(({ entityType, operation }) => entityType === "favorite-weather-place" && operation === "UPSERT");
  if (pending.length === 0) return 0;
  if (getRuntimeDataScope() !== input.scope) throw new Error("USER_SWITCH");
  const { data, error } = await input.client.from("favorite_weather_places")
    .select("id,user_id,sync_id,name,latitude,longitude,revision,created_at,updated_at,deleted_at")
    .in("id", [...new Set(pending.map(({ entityId }) => entityId))])
    .not("deleted_at", "is", null);
  if (error) throw new CloudPullTechnicalError("READ_PAGE", error.code ?? "UNKNOWN", "Favorite identity collision read failed");
  let repaired = 0;
  for (const raw of data ?? []) {
    if (getRuntimeDataScope() !== input.scope) throw new Error("USER_SWITCH");
    const row = parseFavoriteWeatherPlaceCloudRow(raw);
    const result = await repairFavoriteWeatherTombstoneIdentityCollision({ scope: input.scope, storage: input.storage, outbox, row, pending: pending.filter(({ entityId }) => entityId === row.id) });
    if (result.repaired) { repaired += 1; await issues.remove("favorite-weather-place", row.id); }
  }
  return repaired;
}

export function createBrowserFavoriteLaunchSitePullService(input: Readonly<{
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
    favoriteLaunchSiteDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("favorite_launch_sites")
          .select("id,user_id,sync_id,name,source_name,latitude,longitude,icao_code,altitude_amsl_m,revision,created_at,updated_at,deleted_at")
          .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
        return (data ?? []).map(parseFavoriteLaunchSiteCloudRow);
      },
      applyLocally: (row) => applyFavoriteLaunchSiteFromCloudWithoutEnqueue(input.scope, {
        id: row.id,
        ...(row.syncId ? { syncId: row.syncId } : {}),
        name: row.name,
        ...(row.sourceName ? { sourceName: row.sourceName } : {}),
        latitude: row.latitude,
        longitude: row.longitude,
        ...(row.icaoCode ? { icaoCode: row.icaoCode } : {}),
        ...(row.altitudeAmslM === null ? {} : { altitudeAmslM: row.altitudeAmslM }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      }, input.storage),
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
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
        : domain === "aviation-preferences"
          ? applyAviationPreferencesFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage)
          : domain === "pilot-qualifications"
            ? applyPilotQualificationsFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage)
            : applyActiveBalloonPreferenceFromCloudWithoutEnqueue(input.scope, row.value, Boolean(row.deletedAt), input.storage),
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
      "pilot-qualifications": adapter("pilot-qualifications"),
      "balloon-preferences": adapter("balloon-preferences"),
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}

export function createBrowserPilotProfilePullService(input: Readonly<{
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
    profileDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("profiles")
          .select("id,user_id,revision,created_at,updated_at,deleted_at,first_name,last_name,license_number,usual_function,flight_test_due_date,medical_due_date,experience_confirmed,opening_ascensions,opening_official_duration_minutes")
          .eq("id", "profile").order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
        return (data ?? []).map(pilotProfileRow);
      },
      applyLocally: (row) => {
        const local = row.value as CloudPilotProfileLocalValue;
        if (!applyPilotProfileFromCloudWithoutEnqueue(input.scope, row.deletedAt ? null : local.profile, input.storage)) return false;
        return applyOpeningBalanceFromCloudWithoutEnqueue(input.scope, row.deletedAt
          ? { confirmed: false, ascensions: null, officialDurationMinutes: null }
          : local.openingBalance, input.storage);
      },
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
        return (data ?? []).map(parseBalloonCloudRow);
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

export function createBrowserFlightPullService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
}>): CloudPullService {
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  const issues = new BrowserCloudSyncIssueRepository(input.storage, input.scope);
  const flights = new IndexedDbRecordedFlightStorage();
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
    flightDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("flights")
          .select("id,user_id,revision,created_at,updated_at,deleted_at,schema_version,status,started_at,ended_at,balloon_id,balloon_registration,start_location_label,end_location_label,generated_title,custom_title,notes,origin,logbook_status,recovered,summary,weather_model,weather_snapshot,ground_calibration")
          .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new CloudPullTechnicalError("READ_PAGE", error.code ?? "SUPABASE_READ_ERROR", `flights SELECT: ${error.message}`);
        try {
          return (data ?? []).map(parseFlightCloudRow);
        } catch (error) {
          throw new CloudPullTechnicalError("PARSE_ROW", "INVALID_FLIGHT_ROW", error instanceof Error ? error.message : "Invalid flight cloud row");
        }
      },
      applyLocally: async (row) => {
        const local = row.value as CloudFlightLocalValue;
        const flight = row.deletedAt ? null : local.flight;
        if (!await flights.applyFromCloudWithoutEnqueue(input.scope, row.entityId, flight)) return false;
        const mergedFlight = row.deletedAt ? null : await flights.getFlight(row.entityId);
        return applyRecordedFlightToJournalFromCloudWithoutEnqueue(input.scope, row.entityId, mergedFlight, row.deletedAt ? null : local.journal, input.storage);
      },
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}

export function createBrowserLogbookEntryPullService(input: Readonly<{
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
    logbookEntryDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("logbook_entries")
          .select("id,user_id,revision,created_at,updated_at,deleted_at,flight_id,source,date_iso,balloon_model,balloon_manufacturer,registration,departure,arrival,category,pilot_function,regulatory_role,supervised_by_fi_b,night_flight,maximum_altitude_m,gps_duration_minutes,official_duration_minutes,observations,flight_nature,takeoff_count,landing_count,instructor,examiner")
          .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
        return (data ?? []).map(parseLogbookEntryCloudRow);
      },
      localAnomaly: (row) => row.deletedAt ? null : hasOfficialAscensionSourceFlightConflict(row.entityId, (row.value as OfficialAscension).sourceFlightId) ? "LOCAL_UNIQUENESS_CONFLICT" : null,
      applyLocally: (row) => applyOfficialAscensionFromCloudWithoutEnqueue(input.scope, row.entityId, row.deletedAt ? null : row.value as OfficialAscension, input.storage),
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}

export function createBrowserDocumentPullService(input: Readonly<{
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
    documentDomain: {
      readPage: async (cursor, limit) => {
        let query = input.client.from("documents")
          .select("id,user_id,revision,created_at,updated_at,deleted_at,balloon_id,category,title,original_filename,mime_type,size_bytes,notes,issue_date,expiry_date")
          .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
        if (cursor) query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${quotedPostgrestValue(cursor.id)})`);
        const { data, error } = await query;
        if (error) throw new Error(`Cloud pull read failed: ${error.code ?? "UNKNOWN"}`);
        return (data ?? []).map(parseDocumentCloudRow);
      },
      localAnomaly: async (row) => row.deletedAt && await balloonDocumentStorage.hasLocalBlob(row.entityId) ? "LOCAL_BLOB_PRESENT" : null,
      applyLocally: (row) => balloonDocumentStorage.applyMetadataFromCloudWithoutEnqueue(input.scope, row.entityId, row.deletedAt ? null : row.value as BalloonDocument),
    },
    recordConflict: async (_conflict, mutation, row) => {
      await issues.save({ kind: "CONFLICT", entityType: mutation.entityType, entityId: mutation.entityId, mutation, serverRevision: row.revision, serverUpdatedAt: row.updatedAt, serverDeletedAt: row.deletedAt, recordedAt: new Date().toISOString() });
    },
  });
}
