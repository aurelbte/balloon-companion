import { addCalendarMonths } from "./bplQualificationEngine.ts";
import { createQualificationEvent, normalizeQualificationEvent, type FeBAssessmentKind, type QualificationEvent } from "./pilotQualifications.ts";

export type EditableFeBEventType = "FE_B_CERTIFICATE" | "FE_B_REFRESHER_COURSE" | "FE_B_SUPERVISED_ASSESSMENT";
export type FeBEventDraft = Readonly<{ dateIso: string; expiryDateIso: string; assessmentKind: FeBAssessmentKind | ""; examinerName: string; officialAscensionId: string; classId: string; notes: string }>;
export function emptyFeBEventDraft(event?: QualificationEvent): FeBEventDraft { return { dateIso: event?.dateIso ?? "", expiryDateIso: event?.expiryDateIso ?? "", assessmentKind: event?.assessmentKind ?? "", examinerName: event?.examiner?.name ?? "", officialAscensionId: event?.officialAscensionId ?? "", classId: event?.balloonClass?.classId ?? "", notes: event?.notes ?? "" }; }
export function suggestedFeBCertificateExpiry(issueDateIso: string): string { try { return addCalendarMonths(issueDateIso, 60); } catch { return ""; } }
export function upsertFeBQualificationEvent(events: readonly QualificationEvent[], type: EditableFeBEventType, draft: FeBEventDraft, existingId?: string, options: Readonly<{ uuid?: () => string; now?: () => Date }> = {}) {
  if (!draft.dateIso) return { ok: false as const, error: "Renseignez la date." };
  if (type === "FE_B_CERTIFICATE" && !draft.expiryDateIso) return { ok: false as const, error: "Renseignez la date réelle d’expiration." };
  if (type === "FE_B_CERTIFICATE" && draft.expiryDateIso < draft.dateIso) return { ok: false as const, error: "L’expiration doit suivre la délivrance." };
  if (type === "FE_B_SUPERVISED_ASSESSMENT" && !draft.assessmentKind) return { ok: false as const, error: "Choisissez le type d’acte." };
  if (type === "FE_B_SUPERVISED_ASSESSMENT" && !draft.examinerName.trim()) return { ok: false as const, error: "Renseignez l’inspecteur ou examinateur superviseur." };
  const input = { type, dateIso: draft.dateIso, source: "MANUAL" as const, ...(type === "FE_B_CERTIFICATE" ? { expiryDateIso: draft.expiryDateIso } : {}), ...(type === "FE_B_SUPERVISED_ASSESSMENT" ? { assessmentKind: draft.assessmentKind as FeBAssessmentKind, examiner: { name: draft.examinerName.trim() }, ...(draft.officialAscensionId ? { officialAscensionId: draft.officialAscensionId } : {}), ...(draft.classId ? { balloonClass: { classId: draft.classId } } : {}) } : {}), ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}) };
  const existing = existingId ? events.find((event) => event.id === existingId && event.type === type) : undefined;
  const event = existing ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() }) : createQualificationEvent(input, options);
  if (!event) return { ok: false as const, error: "Événement FE(B) invalide." };
  return { ok: true as const, event, events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event] };
}
