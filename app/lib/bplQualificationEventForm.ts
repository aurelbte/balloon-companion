import type { OfficialAscension } from "./flightCompletion.ts";
import { reconcileQualificationEventForAscension } from "./officialAscensionQualifications.ts";
import { createQualificationEvent, normalizeQualificationEvent, type QualificationEvent } from "./pilotQualifications.ts";

export type EditableBplEventType = "TRAINING_FLIGHT_BPL" | "PROFICIENCY_CHECK_BPL";
export type BplEventDraft = Readonly<{ dateIso: string; personName: string; notes: string; classId: string; groupId: string }>;
export type BplEventUpsertResult =
  | Readonly<{ ok: true; event: QualificationEvent; events: readonly QualificationEvent[] }>
  | Readonly<{ ok: false; error: string }>;

export function emptyBplEventDraft(event?: QualificationEvent): BplEventDraft {
  return {
    dateIso: event?.dateIso ?? "",
    personName: event?.instructor?.name ?? event?.examiner?.name ?? "",
    notes: event?.notes ?? "",
    classId: event?.balloonClass?.classId ?? "",
    groupId: event?.balloonClass?.groupId ?? "",
  };
}

export function upsertInitialBplIssuance(
  events: readonly QualificationEvent[],
  draft: Pick<BplEventDraft, "dateIso" | "notes">,
  existingId?: string,
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): BplEventUpsertResult {
  if (!draft.dateIso) return { ok: false, error: "Renseignez la date de délivrance." };
  const existing = existingId ? events.find(({ id, type }) => id === existingId && type === "INITIAL_BPL_ISSUANCE") : undefined;
  const input = { type: "INITIAL_BPL_ISSUANCE" as const, dateIso: draft.dateIso, source: "MANUAL" as const, ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
  const event = existing
    ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() })
    : createQualificationEvent(input, options);
  if (!event) return { ok: false, error: "Délivrance BPL invalide." };
  return { ok: true, event, events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event] };
}

function validate(type: EditableBplEventType, draft: BplEventDraft, linked: boolean): string | null {
  if (!linked && !draft.dateIso) return type === "TRAINING_FLIGHT_BPL" ? "Renseignez la date du vol." : "Renseignez la date du contrôle.";
  if (!linked && draft.classId !== "HOT_AIR_BALLOON" && draft.classId !== "GAS_BALLOON") return { TRAINING_FLIGHT_BPL: "Renseignez la classe ballon du vol.", PROFICIENCY_CHECK_BPL: "Renseignez la classe ballon du contrôle." }[type];
  if (!linked && draft.classId === "HOT_AIR_BALLOON" && !["A", "B", "C", "D"].includes(draft.groupId)) return "Renseignez le groupe du ballon utilisé.";
  if (!draft.personName.trim()) return type === "TRAINING_FLIGHT_BPL" ? "Renseignez l’instructeur FI(B)." : "Renseignez l’examinateur FE(B).";
  return null;
}

export function upsertHistoricalBplEvent(
  events: readonly QualificationEvent[],
  type: EditableBplEventType,
  draft: BplEventDraft,
  existingId?: string,
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): BplEventUpsertResult {
  const error = validate(type, draft, false);
  if (error) return { ok: false, error };
  const existing = existingId ? events.find(({ id, type: eventType, officialAscensionId }) => id === existingId && eventType === type && !officialAscensionId) : undefined;
  const person = { name: draft.personName.trim() };
  const input = { type, dateIso: draft.dateIso, source: "MANUAL" as const, balloonClass: { classId: draft.classId, ...(draft.classId === "HOT_AIR_BALLOON" ? { groupId: draft.groupId } : {}) }, ...(type === "TRAINING_FLIGHT_BPL" ? { instructor: person } : { examiner: person }), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
  const event = existing
    ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() })
    : createQualificationEvent(input, options);
  if (!event) return { ok: false, error: "Événement BPL invalide." };
  return { ok: true, event, events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event] };
}

export function linkBplEventToAscension(
  events: readonly QualificationEvent[],
  type: EditableBplEventType,
  ascension: OfficialAscension | undefined,
  draft: BplEventDraft,
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): BplEventUpsertResult {
  if (!ascension) return { ok: false, error: "Choisissez une ascension du carnet." };
  const expectedNature = type === "TRAINING_FLIGHT_BPL" ? "TRAINING_BPL" : "PROFICIENCY_CHECK_BPL";
  if (ascension.flightNature !== expectedNature) return { ok: false, error: "Cette ascension ne correspond pas au type choisi." };
  if (ascension.category === "Libre à air chaud" && !["A", "B", "C", "D"].includes(draft.groupId)) return { ok: false, error: "Renseignez le groupe du ballon utilisé." };
  const error = validate(type, draft, true);
  if (error) return { ok: false, error };
  const person = { name: draft.personName.trim() };
  const reconciled = reconcileQualificationEventForAscension({ ...ascension, ...(type === "TRAINING_FLIGHT_BPL" ? { instructor: person } : { examiner: person }) }, events, options);
  const linked = reconciled.linkedEventId ? reconciled.events.find(({ id }) => id === reconciled.linkedEventId) : undefined;
  if (!linked) return { ok: false, error: "Association au carnet impossible." };
  const now = (options.now ?? (() => new Date()))().toISOString();
  const event = normalizeQualificationEvent({ ...linked, balloonClass: { classId: linked.balloonClass?.classId ?? (ascension.category === "Libre à gaz" ? "GAS_BALLOON" : "HOT_AIR_BALLOON"), ...(ascension.category === "Libre à air chaud" ? { groupId: draft.groupId } : {}) }, ...(type === "TRAINING_FLIGHT_BPL" ? { instructor: person, examiner: undefined } : { examiner: person, instructor: undefined }), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : { notes: undefined }), updatedAt: now });
  if (!event) return { ok: false, error: "Événement BPL invalide." };
  return { ok: true, event, events: reconciled.events.map((item) => item.id === event.id ? event : item) };
}

export function updateLinkedBplEventProof(
  events: readonly QualificationEvent[],
  type: EditableBplEventType,
  draft: BplEventDraft,
  existingId: string,
  now: () => Date = () => new Date(),
): BplEventUpsertResult {
  const error = validate(type, draft, true);
  if (error) return { ok: false, error };
  const existing = events.find(({ id, type: eventType, officialAscensionId }) => id === existingId && eventType === type && officialAscensionId);
  if (!existing) return { ok: false, error: "Preuve liée introuvable." };
  const person = { name: draft.personName.trim() };
  const event = normalizeQualificationEvent({ ...existing, balloonClass: { classId: existing.balloonClass?.classId ?? draft.classId, ...(existing.balloonClass?.classId === "HOT_AIR_BALLOON" || draft.classId === "HOT_AIR_BALLOON" ? { groupId: draft.groupId || existing.balloonClass?.groupId } : {}) }, ...(type === "TRAINING_FLIGHT_BPL" ? { instructor: person, examiner: undefined } : { examiner: person, instructor: undefined }), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : { notes: undefined }), updatedAt: now().toISOString() });
  if (!event) return { ok: false, error: "Événement BPL invalide." };
  return { ok: true, event, events: events.map((item) => item.id === event.id ? event : item) };
}
