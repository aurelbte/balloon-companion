import { officialAscensionFlightNature, type OfficialAscension, type OfficialFlightNature } from "./flightCompletion.ts";
import { createQualificationEvent, normalizeQualificationEvent, type QualificationEvent, type QualificationEventType } from "./pilotQualifications.ts";

const EVENT_TYPE_BY_NATURE = Object.freeze({
  TRAINING_BPL: "TRAINING_FLIGHT_BPL",
  PROFICIENCY_CHECK_BPL: "PROFICIENCY_CHECK_BPL",
  SKILL_TEST: "SKILL_TEST_BPL",
  COMMERCIAL_PROFICIENCY_CHECK: "COMMERCIAL_PROFICIENCY_CHECK",
} as const satisfies Partial<Record<OfficialFlightNature, QualificationEventType>>);

export type AscensionQualificationLinkStatus =
  | "CREATED"
  | "UPDATED"
  | "UNCHANGED"
  | "UNMAPPED"
  | "MISSING_FI"
  | "MISSING_FE"
  | "LINKED_EVENT_RETAINED";

export type AscensionQualificationLinkResult = Readonly<{
  status: AscensionQualificationLinkStatus;
  events: readonly QualificationEvent[];
  linkedEventId?: string;
  duplicateEventIds: readonly string[];
}>;

export function qualificationEventTypeForFlightNature(nature: OfficialFlightNature): QualificationEventType | null {
  return EVENT_TYPE_BY_NATURE[nature as keyof typeof EVENT_TYPE_BY_NATURE] ?? null;
}

export function flightNatureRequiresInstructor(nature: OfficialFlightNature): boolean {
  return nature === "TRAINING_BPL" || nature === "COMMERCIAL_TRAINING" || nature === "INSTRUCTION";
}

export function flightNatureRequiresExaminer(nature: OfficialFlightNature): boolean {
  return nature === "PROFICIENCY_CHECK_BPL" || nature === "SKILL_TEST" || nature === "COMMERCIAL_PROFICIENCY_CHECK";
}

function balloonClass(ascension: OfficialAscension): Readonly<{ classId: string }> {
  return { classId: ascension.category === "Libre à gaz" ? "GAS_BALLOON" : "HOT_AIR_BALLOON" };
}

export function reconcileQualificationEventForAscension(
  ascension: OfficialAscension,
  events: readonly QualificationEvent[],
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): AscensionQualificationLinkResult {
  const linked = events.filter(({ officialAscensionId }) => officialAscensionId === ascension.id);
  const existing = linked[0] ?? null;
  const duplicates = linked.slice(1).map(({ id }) => id);
  const type = qualificationEventTypeForFlightNature(officialAscensionFlightNature(ascension));
  if (!type) return { status: existing ? "LINKED_EVENT_RETAINED" : "UNMAPPED", events, ...(existing ? { linkedEventId: existing.id } : {}), duplicateEventIds: duplicates };
  if (type === "TRAINING_FLIGHT_BPL" && !ascension.instructor?.name.trim()) return { status: "MISSING_FI", events, ...(existing ? { linkedEventId: existing.id } : {}), duplicateEventIds: duplicates };
  if (["PROFICIENCY_CHECK_BPL", "SKILL_TEST_BPL", "COMMERCIAL_PROFICIENCY_CHECK"].includes(type) && !ascension.examiner?.name.trim()) return { status: "MISSING_FE", events, ...(existing ? { linkedEventId: existing.id } : {}), duplicateEventIds: duplicates };

  if (!existing) {
    const created = createQualificationEvent({ type, dateIso: ascension.dateIso, source: "OFFICIAL_ASCENSION", officialAscensionId: ascension.id, balloonClass: balloonClass(ascension), ...(ascension.instructor ? { instructor: ascension.instructor } : {}), ...(ascension.examiner ? { examiner: ascension.examiner } : {}) }, options);
    return { status: "CREATED", events: [...events, created], linkedEventId: created.id, duplicateEventIds: [] };
  }
  const now = (options.now ?? (() => new Date()))().toISOString();
  const { instructor: _previousInstructor, examiner: _previousExaminer, officialAscensionDeletedAt: _previousDeletion, ...existingWithoutPeople } = existing;
  const updated: QualificationEvent = { ...existingWithoutPeople, type, dateIso: ascension.dateIso, source: "OFFICIAL_ASCENSION", officialAscensionId: ascension.id, balloonClass: balloonClass(ascension), ...(ascension.instructor ? { instructor: ascension.instructor } : {}), ...(ascension.examiner ? { examiner: ascension.examiner } : {}), updatedAt: now };
  const comparable = normalizeQualificationEvent({ ...updated, updatedAt: existing.updatedAt });
  if (comparable && JSON.stringify(existing) === JSON.stringify(comparable)) return { status: "UNCHANGED", events, linkedEventId: existing.id, duplicateEventIds: duplicates };
  return { status: "UPDATED", events: events.map((event) => event.id === existing.id ? updated : event), linkedEventId: existing.id, duplicateEventIds: duplicates };
}

/** Une suppression d'ascension ne supprime jamais silencieusement sa preuve réglementaire. */
export function qualificationEventsAfterAscensionRemoval(
  ascensionId: string,
  events: readonly QualificationEvent[],
  now: () => Date = () => new Date(),
): Readonly<{ events: readonly QualificationEvent[]; retainedEventIds: readonly string[] }> {
  const retainedEventIds = events.filter((event) => event.officialAscensionId === ascensionId).map(({ id }) => id);
  if (!retainedEventIds.length) return { events, retainedEventIds };
  const deletedAt = now().toISOString();
  return {
    events: events.map((event) => event.officialAscensionId === ascensionId ? { ...event, officialAscensionDeletedAt: deletedAt, updatedAt: deletedAt } : event),
    retainedEventIds,
  };
}
