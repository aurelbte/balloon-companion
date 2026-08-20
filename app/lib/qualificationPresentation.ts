import type { QualificationRequirementResult, QualificationRequirementStatus } from "./bplQualificationEngine.ts";
import type { QualificationEventType } from "./pilotQualifications.ts";

export const QUALIFICATION_STATUS_LABELS: Readonly<Record<QualificationRequirementStatus, string>> = Object.freeze({
  COMPLIANT: "À jour",
  UPCOMING: "À prévoir",
  WARNING: "Échéance proche",
  ACTION_REQUIRED: "Action requise",
  UNKNOWN: "Données insuffisantes",
  NON_APPLICABLE: "Non concerné",
});

export const QUALIFICATION_EVENT_LABELS: Readonly<Record<QualificationEventType, string>> = Object.freeze({
  INITIAL_BPL_ISSUANCE: "Délivrance initiale BPL",
  TRAINING_FLIGHT_BPL: "Vol d’entraînement BPL",
  PROFICIENCY_CHECK_BPL: "Contrôle de compétences BPL",
  SKILL_TEST_BPL: "Examen pratique BPL",
  INITIAL_COMMERCIAL_ISSUANCE: "Délivrance initiale — activité professionnelle",
  COMMERCIAL_PROFICIENCY_CHECK: "Contrôle de compétences professionnel",
  COMMERCIAL_REFRESHER_COURSE: "Formation / remise à niveau professionnelle",
  MEDICAL: "Certificat médical",
  FIRST_AID: "Premiers secours / PSC1",
  FIRE_TRAINING: "Formation incendie",
  OTHER_TRAINING: "Autre formation professionnelle",
  LEGACY_FLIGHT_TEST_DUE_DATE: "Ancienne échéance « vol test »",
});

export function qualificationStatusLabel(status: QualificationRequirementStatus): string {
  return QUALIFICATION_STATUS_LABELS[status];
}

export function qualificationEventLabel(type: QualificationEventType): string {
  return QUALIFICATION_EVENT_LABELS[type];
}

export function qualificationClassLabel(classId: string): string {
  if (classId === "HOT_AIR_BALLOON") return "Ballon libre à air chaud";
  if (classId === "GAS_BALLOON") return "Ballon libre à gaz";
  return classId || "Classe inconnue";
}

export function formatQualificationDate(dateIso: string | undefined): string {
  if (!dateIso) return "Non renseignée";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("fr-FR") : "Date invalide";
}

const STATUS_PRIORITY: Readonly<Record<QualificationRequirementStatus, number>> = Object.freeze({
  ACTION_REQUIRED: 5,
  UNKNOWN: 4,
  WARNING: 3,
  UPCOMING: 2,
  COMPLIANT: 1,
  NON_APPLICABLE: 0,
});

export function mostRestrictiveQualificationResult(results: readonly QualificationRequirementResult[]): QualificationRequirementResult {
  if (!results.length) return { status: "UNKNOWN", reason: "Données insuffisantes." };
  return results.slice(1).reduce<QualificationRequirementResult>(
    (current, candidate) => STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[current.status] ? candidate : current,
    results[0]!,
  );
}
