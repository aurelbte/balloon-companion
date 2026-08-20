import {
  createQualificationEvent,
  normalizeQualificationEvent,
  type QualificationEvent,
  type QualificationEventType,
} from "./pilotQualifications.ts";

export type EditableQualificationEventType = "MEDICAL" | "FIRST_AID" | "FIRE_TRAINING";

export type QualificationEventDraft = Readonly<{
  dateIso: string;
  expiryDateIso: string;
  medicalClass: string;
  organization: string;
  notes: string;
}>;

export type QualificationEventUpsertResult =
  | Readonly<{ ok: true; event: QualificationEvent; events: readonly QualificationEvent[] }>
  | Readonly<{ ok: false; error: string }>;

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

export function emptyQualificationEventDraft(event?: QualificationEvent): QualificationEventDraft {
  return {
    dateIso: event?.dateIso ?? "",
    expiryDateIso: event?.expiryDateIso ?? "",
    medicalClass: event?.medicalClass ?? "",
    organization: event?.organization ?? "",
    notes: event?.notes ?? "",
  };
}

export function upsertQualificationEvent(
  events: readonly QualificationEvent[],
  type: EditableQualificationEventType,
  draft: QualificationEventDraft,
  existingId?: string,
  options: Readonly<{ uuid?: () => string; now?: () => Date }> = {},
): QualificationEventUpsertResult {
  if (type === "MEDICAL" && !draft.medicalClass) return { ok: false, error: "Choisissez une classe médicale." };
  if (!draft.dateIso) return { ok: false, error: type === "MEDICAL" ? "Renseignez la date médicale." : "Renseignez la date de formation." };
  if (type === "MEDICAL" && !draft.expiryDateIso) return { ok: false, error: "Renseignez la date d’échéance." };
  if (draft.expiryDateIso && draft.expiryDateIso < draft.dateIso) return { ok: false, error: "L’échéance doit suivre la date de l’événement." };

  const input = {
    type: type as QualificationEventType,
    dateIso: draft.dateIso,
    source: "MANUAL" as const,
    ...(optional(draft.expiryDateIso) ? { expiryDateIso: optional(draft.expiryDateIso) } : {}),
    ...(type === "MEDICAL" ? { medicalClass: draft.medicalClass } : {}),
    ...(optional(draft.organization) ? { organization: optional(draft.organization) } : {}),
    ...(optional(draft.notes) ? { notes: optional(draft.notes) } : {}),
  };
  const existing = existingId ? events.find(({ id, type: eventType }) => id === existingId && eventType === type) : undefined;
  const event = existing
    ? normalizeQualificationEvent({ ...input, id: existing.id, createdAt: existing.createdAt, updatedAt: (options.now ?? (() => new Date()))().toISOString() })
    : createQualificationEvent(input, options);
  if (!event) return { ok: false, error: "Événement de qualification invalide." };
  return {
    ok: true,
    event,
    events: existing ? events.map((item) => item.id === existing.id ? event : item) : [...events, event],
  };
}
