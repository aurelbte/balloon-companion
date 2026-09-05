import { COMMERCIAL_REGULATORY_RULES } from "./commercialQualificationEngine.ts";
import { createQualificationEvent, normalizeQualificationEvent, type QualificationEvent } from "./pilotQualifications.ts";

export type EditableCommercialEventType = "INITIAL_COMMERCIAL_ISSUANCE" | "COMMERCIAL_PROFICIENCY_CHECK" | "COMMERCIAL_REFRESHER_COURSE";
export type CommercialEventDraft = Readonly<{ dateIso: string; classId: string; groupId: string; personName: string; theoryMinutes: string; trainingEventId: string; notes: string }>;
export type CommercialEventUpsertResult = Readonly<{ ok: true; event: QualificationEvent; events: readonly QualificationEvent[] }> | Readonly<{ ok: false; error: string }>;

export function emptyCommercialEventDraft(event?: QualificationEvent): CommercialEventDraft {
  return { dateIso: event?.dateIso ?? "", classId: event?.balloonClass?.classId ?? "", groupId: event?.balloonClass?.groupId ?? "", personName: event?.examiner?.name ?? "", theoryMinutes: event?.theoryMinutes === undefined ? "" : String(event.theoryMinutes), trainingEventId: event?.relatedEventIds?.[0] ?? "", notes: event?.notes ?? "" };
}

export function upsertCommercialQualificationEvent(events: readonly QualificationEvent[], type: EditableCommercialEventType, draft: CommercialEventDraft, existingId?: string, options: Readonly<{ uuid?: () => string; now?: () => Date }> = {}): CommercialEventUpsertResult {
  if (!draft.dateIso) return { ok: false, error: "Renseignez la date." };
  if (!draft.classId) return { ok: false, error: "Choisissez une classe ballon." };
  if (draft.classId === "HOT_AIR_BALLOON" && !["A", "B", "C", "D"].includes(draft.groupId)) return { ok: false, error: "Choisissez le groupe hot-air." };
  if (type === "COMMERCIAL_PROFICIENCY_CHECK" && !draft.personName.trim()) return { ok: false, error: "Renseignez l’examinateur FE(B)." };
  const theoryMinutes = Number(draft.theoryMinutes);
  if (type === "COMMERCIAL_REFRESHER_COURSE" && (!Number.isInteger(theoryMinutes) || theoryMinutes < COMMERCIAL_REGULATORY_RULES.refresherTheoryMinutes)) return { ok: false, error: `Renseignez au moins ${COMMERCIAL_REGULATORY_RULES.refresherTheoryMinutes} minutes de théorie.` };
  if (type === "COMMERCIAL_REFRESHER_COURSE" && !draft.trainingEventId) return { ok: false, error: "Choisissez le vol avec FI(B) associé." };
  if (type === "COMMERCIAL_REFRESHER_COURSE" && !events.some(({ id, type: eventType, instructor, balloonClass }) => id === draft.trainingEventId && eventType === "TRAINING_FLIGHT_BPL" && instructor?.name.trim() && balloonClass?.classId === draft.classId && (draft.classId !== "HOT_AIR_BALLOON" || balloonClass.groupId === draft.groupId))) return { ok: false, error: "Le vol FI(B) doit correspondre à la même classe et au même groupe ballon." };
  const existing = existingId ? events.find(({ id, type: eventType }) => id === existingId && eventType === type) : undefined;
  const input = { type, dateIso: draft.dateIso, source: "MANUAL" as const, balloonClass: { classId: draft.classId, ...(draft.classId === "HOT_AIR_BALLOON" ? { groupId: draft.groupId } : {}) }, ...(type === "COMMERCIAL_PROFICIENCY_CHECK" ? { examiner: { name: draft.personName.trim() } } : {}), ...(type === "COMMERCIAL_REFRESHER_COURSE" ? { theoryMinutes, relatedEventIds: [draft.trainingEventId] } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
  const event = existing ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() }) : createQualificationEvent(input, options);
  if (!event) return { ok: false, error: "Événement professionnel invalide." };
  return { ok: true, event, events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event] };
}
