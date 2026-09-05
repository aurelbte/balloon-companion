import { createQualificationEvent, normalizeQualificationEvent, type QualificationEvent } from "./pilotQualifications.ts";

export type EditableFiBEventType = "FI_B_REFRESHER_TRAINING" | "FI_B_SUPERVISED_INSTRUCTION" | "FI_B_ASSESSMENT_OF_COMPETENCE";
export type FiBEventDraft = Readonly<{ dateIso: string; officialAscensionId: string; classId: string; personName: string; notes: string }>;
export type FiBEventUpsertResult = Readonly<{ ok: true; event: QualificationEvent; events: readonly QualificationEvent[] }> | Readonly<{ ok: false; error: string }>;

export function emptyFiBEventDraft(event?: QualificationEvent): FiBEventDraft {
  return { dateIso: event?.dateIso ?? "", officialAscensionId: event?.officialAscensionId ?? "", classId: event?.balloonClass?.classId ?? "", personName: event?.instructor?.name ?? event?.examiner?.name ?? "", notes: event?.notes ?? "" };
}

export function upsertFiBQualificationEvent(events: readonly QualificationEvent[], type: EditableFiBEventType, draft: FiBEventDraft, existingId?: string, options: Readonly<{ uuid?: () => string; now?: () => Date }> = {}): FiBEventUpsertResult {
  if (!draft.dateIso) return { ok: false, error: "Renseignez la date." };
  const personName = draft.personName.trim();
  const input = { type, dateIso: draft.dateIso, source: "MANUAL" as const, ...(draft.officialAscensionId ? { officialAscensionId: draft.officialAscensionId } : {}), ...(draft.classId ? { balloonClass: { classId: draft.classId } } : {}), ...(type === "FI_B_SUPERVISED_INSTRUCTION" && personName ? { instructor: { name: personName } } : {}), ...(type === "FI_B_ASSESSMENT_OF_COMPETENCE" && personName ? { examiner: { name: personName } } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
  const existing = existingId ? events.find((event) => event.id === existingId && event.type === type) : undefined;
  const event = existing ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() }) : createQualificationEvent(input, options);
  if (!event) return { ok: false, error: "Événement FI(B) invalide." };
  return { ok: true, event, events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event] };
}
