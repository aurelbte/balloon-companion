import type { PilotProfile } from "./pilotProfile.ts";

export const PILOT_QUALIFICATIONS_VERSION = 1;

export type QualificationEventType =
  | "INITIAL_BPL_ISSUANCE"
  | "TRAINING_FLIGHT_BPL"
  | "PROFICIENCY_CHECK_BPL"
  | "SKILL_TEST_BPL"
  | "INITIAL_COMMERCIAL_ISSUANCE"
  | "COMMERCIAL_PROFICIENCY_CHECK"
  | "COMMERCIAL_REFRESHER_COURSE"
  | "MEDICAL"
  | "FIRST_AID"
  | "FIRE_TRAINING"
  | "OTHER_TRAINING"
  | "LEGACY_FLIGHT_TEST_DUE_DATE";

export const QUALIFICATION_EVENT_TYPES = Object.freeze([
  "INITIAL_BPL_ISSUANCE",
  "TRAINING_FLIGHT_BPL",
  "PROFICIENCY_CHECK_BPL",
  "SKILL_TEST_BPL",
  "INITIAL_COMMERCIAL_ISSUANCE",
  "COMMERCIAL_PROFICIENCY_CHECK",
  "COMMERCIAL_REFRESHER_COURSE",
  "MEDICAL",
  "FIRST_AID",
  "FIRE_TRAINING",
  "OTHER_TRAINING",
  "LEGACY_FLIGHT_TEST_DUE_DATE",
] as const satisfies readonly QualificationEventType[]);

export type QualificationEventSource = "MANUAL" | "OFFICIAL_ASCENSION" | "LEGACY_ADAPTER";

export type QualificationPersonSnapshot = Readonly<{
  name: string;
  licenceNumber?: string;
}>;

export type QualificationBalloonClass = Readonly<{
  classId: string;
  /** Réservé à une future nomenclature de groupes, sans dépendance au modèle ballon. */
  groupId?: string;
}>;

export type BplBalloonClass = "HOT_AIR_BALLOON" | "GAS_BALLOON";
export const BPL_BALLOON_CLASSES = Object.freeze([
  "HOT_AIR_BALLOON",
  "GAS_BALLOON",
] as const satisfies readonly BplBalloonClass[]);

export type QualificationMedicalClass = "LAPL" | "CLASS_2" | (string & {});

export type DeclaredBplInitialSituation = Readonly<{
  referenceDateIso: string | null;
  recentExperienceSatisfied: boolean | null;
}>;

export type DeclaredCommercialInitialSituation = Readonly<{
  balloonClass: QualificationBalloonClass;
  referenceDateIso: string | null;
  recencySatisfied: boolean | null;
}>;

export type QualificationProfile = Readonly<{
  configured: boolean;
  historyCoverageStartDate: string | null;
  declaredBplInitialSituation: DeclaredBplInitialSituation;
  declaredCommercialInitialSituations: readonly DeclaredCommercialInitialSituation[];
  licenceType: string | null;
  bplBalloonClasses: readonly BplBalloonClass[];
  commercialOperationsEnabled: boolean;
  fiBEnabled: boolean;
  feBEnabled: boolean;
}>;

export type QualificationEvent = Readonly<{
  id: string;
  type: QualificationEventType;
  dateIso: string;
  expiryDateIso?: string;
  source: QualificationEventSource;
  officialAscensionId?: string;
  officialAscensionDeletedAt?: string;
  balloonId?: string;
  balloonClass?: QualificationBalloonClass;
  instructor?: QualificationPersonSnapshot;
  examiner?: QualificationPersonSnapshot;
  theoryMinutes?: number;
  relatedEventIds?: readonly string[];
  medicalClass?: QualificationMedicalClass;
  organization?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type LegacyQualificationDeadlines = Readonly<{
  flightTestDueDateIso: string | null;
  medicalDueDateIso: string | null;
}>;

export type PilotQualificationsState = Readonly<{
  version: typeof PILOT_QUALIFICATIONS_VERSION;
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  legacy: LegacyQualificationDeadlines;
}>;

export type NewQualificationEvent = Omit<QualificationEvent, "id" | "createdAt" | "updatedAt">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createEmptyQualificationProfile(): QualificationProfile {
  return {
    configured: false,
    historyCoverageStartDate: null,
    declaredBplInitialSituation: { referenceDateIso: null, recentExperienceSatisfied: null },
    declaredCommercialInitialSituations: [],
    licenceType: null,
    bplBalloonClasses: [],
    commercialOperationsEnabled: false,
    fiBEnabled: false,
    feBEnabled: false,
  };
}

export function emptyLegacyQualificationDeadlines(): LegacyQualificationDeadlines {
  return { flightTestDueDateIso: null, medicalDueDateIso: null };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalDate(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE.test(value) ? value : undefined;
}

function person(value: unknown): QualificationPersonSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<QualificationPersonSnapshot>;
  const name = optionalText(candidate.name);
  if (!name) return undefined;
  const licenceNumber = optionalText(candidate.licenceNumber);
  return { name, ...(licenceNumber ? { licenceNumber } : {}) };
}

function balloonClass(value: unknown): QualificationBalloonClass | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<QualificationBalloonClass>;
  const classId = optionalText(candidate.classId);
  if (!classId) return undefined;
  const groupId = optionalText(candidate.groupId);
  return { classId: classId.toUpperCase(), ...(groupId ? { groupId: groupId.toUpperCase() } : {}) };
}

export function normalizeQualificationProfile(value: unknown): QualificationProfile {
  const candidate = value && typeof value === "object" ? value as Partial<QualificationProfile> : {};
  const licenceType = optionalText(candidate.licenceType)?.toUpperCase() ?? null;
  const bplBalloonClasses = Array.isArray(candidate.bplBalloonClasses)
    ? BPL_BALLOON_CLASSES.filter((classId) => candidate.bplBalloonClasses!.includes(classId))
    : [];
  const commercialOperationsEnabled = candidate.commercialOperationsEnabled === true;
  const fiBEnabled = candidate.fiBEnabled === true;
  const feBEnabled = candidate.feBEnabled === true;
  const historyCoverageStartDate = optionalDate(candidate.historyCoverageStartDate) ?? null;
  const rawBpl = candidate.declaredBplInitialSituation && typeof candidate.declaredBplInitialSituation === "object"
    ? candidate.declaredBplInitialSituation as Partial<DeclaredBplInitialSituation>
    : {};
  const declaredBplInitialSituation: DeclaredBplInitialSituation = {
    referenceDateIso: optionalDate(rawBpl.referenceDateIso) ?? null,
    recentExperienceSatisfied: typeof rawBpl.recentExperienceSatisfied === "boolean" ? rawBpl.recentExperienceSatisfied : null,
  };
  const declaredCommercialInitialSituations = Array.isArray(candidate.declaredCommercialInitialSituations)
    ? candidate.declaredCommercialInitialSituations.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const raw = value as Partial<DeclaredCommercialInitialSituation>;
      const normalizedClass = balloonClass(raw.balloonClass);
      if (!normalizedClass) return [];
      return [{
        balloonClass: normalizedClass,
        referenceDateIso: optionalDate(raw.referenceDateIso) ?? null,
        recencySatisfied: typeof raw.recencySatisfied === "boolean" ? raw.recencySatisfied : null,
      } satisfies DeclaredCommercialInitialSituation];
    })
    : [];
  return {
    configured: typeof candidate.configured === "boolean"
      ? candidate.configured
      : licenceType !== null || bplBalloonClasses.length > 0 || commercialOperationsEnabled || fiBEnabled || feBEnabled || historyCoverageStartDate !== null,
    historyCoverageStartDate,
    declaredBplInitialSituation,
    declaredCommercialInitialSituations,
    licenceType,
    bplBalloonClasses,
    commercialOperationsEnabled,
    fiBEnabled,
    feBEnabled,
  };
}

export function normalizeQualificationEvent(value: unknown): QualificationEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<QualificationEvent>;
  if (
    typeof candidate.id !== "string" || !UUID.test(candidate.id) ||
    !QUALIFICATION_EVENT_TYPES.includes(candidate.type as QualificationEventType) ||
    typeof candidate.dateIso !== "string" || !ISO_DATE.test(candidate.dateIso) ||
    !["MANUAL", "OFFICIAL_ASCENSION", "LEGACY_ADAPTER"].includes(String(candidate.source)) ||
    typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt)) ||
    typeof candidate.updatedAt !== "string" || !Number.isFinite(Date.parse(candidate.updatedAt))
  ) return null;
  const expiryDateIso = optionalDate(candidate.expiryDateIso);
  const officialAscensionId = optionalText(candidate.officialAscensionId);
  const officialAscensionDeletedAt = typeof candidate.officialAscensionDeletedAt === "string" && Number.isFinite(Date.parse(candidate.officialAscensionDeletedAt))
    ? candidate.officialAscensionDeletedAt
    : undefined;
  const balloonId = optionalText(candidate.balloonId);
  const eventBalloonClass = balloonClass(candidate.balloonClass);
  const instructor = person(candidate.instructor);
  const examiner = person(candidate.examiner);
  const theoryMinutes = typeof candidate.theoryMinutes === "number" && Number.isInteger(candidate.theoryMinutes) && candidate.theoryMinutes >= 0
    ? candidate.theoryMinutes
    : undefined;
  const relatedEventIds = Array.isArray(candidate.relatedEventIds)
    ? [...new Set(candidate.relatedEventIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))]
    : [];
  const medicalClass = optionalText(candidate.medicalClass)?.toUpperCase();
  const organization = optionalText(candidate.organization);
  const notes = optionalText(candidate.notes);
  return {
    id: candidate.id,
    type: candidate.type as QualificationEventType,
    dateIso: candidate.dateIso,
    ...(expiryDateIso ? { expiryDateIso } : {}),
    source: candidate.source as QualificationEventSource,
    ...(officialAscensionId ? { officialAscensionId } : {}),
    ...(officialAscensionDeletedAt ? { officialAscensionDeletedAt } : {}),
    ...(balloonId ? { balloonId } : {}),
    ...(eventBalloonClass ? { balloonClass: eventBalloonClass } : {}),
    ...(instructor ? { instructor } : {}),
    ...(examiner ? { examiner } : {}),
    ...(theoryMinutes !== undefined ? { theoryMinutes } : {}),
    ...(relatedEventIds.length ? { relatedEventIds } : {}),
    ...(medicalClass ? { medicalClass } : {}),
    ...(organization ? { organization } : {}),
    ...(notes ? { notes } : {}),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

export function createQualificationEvent(
  input: NewQualificationEvent,
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): QualificationEvent {
  const id = (options.uuid ?? (() => globalThis.crypto.randomUUID()))();
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const event = normalizeQualificationEvent({ ...input, id, createdAt: timestamp, updatedAt: timestamp });
  if (!event) throw new TypeError("Événement de qualification invalide.");
  return event;
}

/** Adaptateur en lecture seule : aucune échéance legacy n'est reclassée en événement. */
export function legacyQualificationDeadlines(profile: PilotProfile): LegacyQualificationDeadlines {
  return {
    flightTestDueDateIso: profile.flightTestDueDateIso || null,
    medicalDueDateIso: profile.medicalDueDateIso || null,
  };
}
