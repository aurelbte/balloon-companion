import type { QualificationRequirementResult, QualificationRequirementStatus } from "./bplQualificationEngine.ts";
import type { LegacyQualificationDeadlines, QualificationEvent, QualificationMedicalClass, QualificationProfile } from "./pilotQualifications.ts";

export const MEDICAL_TRAINING_UX_THRESHOLDS = Object.freeze({ upcomingDays: 180, warningDays: 90 });

export type RequiredMedicalClass = "LAPL" | "CLASS_2";
export type ProfessionalTrainingType = "FIRST_AID" | "FIRE_TRAINING" | "OTHER_TRAINING";

export type MedicalQualificationResult = Readonly<{
  requiredClass: RequiredMedicalClass;
  expiry: QualificationRequirementResult;
  level: QualificationRequirementResult;
  overall: QualificationRequirementResult;
}>;

const DAY_MS = 86_400_000;

function statusForExpiry(expiryDateIso: string, referenceDateIso: string): QualificationRequirementStatus {
  const due = Date.parse(`${expiryDateIso}T00:00:00Z`);
  const reference = Date.parse(`${referenceDateIso}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(reference)) return "UNKNOWN";
  const remainingDays = Math.round((due - reference) / DAY_MS);
  if (remainingDays < 0) return "ACTION_REQUIRED";
  if (remainingDays <= MEDICAL_TRAINING_UX_THRESHOLDS.warningDays) return "WARNING";
  if (remainingDays <= MEDICAL_TRAINING_UX_THRESHOLDS.upcomingDays) return "UPCOMING";
  return "COMPLIANT";
}

function active(status: QualificationRequirementStatus): boolean {
  return status === "COMPLIANT" || status === "UPCOMING" || status === "WARNING";
}

function medicalLevel(className: QualificationMedicalClass | undefined): number | null {
  if (className === "LAPL") return 1;
  if (className === "CLASS_2") return 2;
  return null;
}

function requiredLevel(className: RequiredMedicalClass): number {
  return className === "CLASS_2" ? 2 : 1;
}

function latestByExpiry(events: readonly QualificationEvent[]): QualificationEvent | null {
  return [...events]
    .filter((event) => event.expiryDateIso)
    .sort((left, right) => right.expiryDateIso!.localeCompare(left.expiryDateIso!) || right.dateIso.localeCompare(left.dateIso))[0] ?? null;
}

export function calculateMedicalQualification(input: Readonly<{
  events: readonly QualificationEvent[];
  legacy: Pick<LegacyQualificationDeadlines, "medicalDueDateIso">;
  referenceDateIso: string;
  requiredClass?: RequiredMedicalClass;
}>): MedicalQualificationResult {
  const requiredClass = input.requiredClass ?? "LAPL";
  const medicalEvents = input.events.filter((event) => event.type === "MEDICAL" && event.dateIso <= input.referenceDateIso);
  const qualifying = latestByExpiry(medicalEvents.filter((event) => (medicalLevel(event.medicalClass) ?? -1) >= requiredLevel(requiredClass)));
  const dated = qualifying ?? latestByExpiry(medicalEvents);

  let expiry: QualificationRequirementResult;
  if (dated?.expiryDateIso) {
    const status = statusForExpiry(dated.expiryDateIso, input.referenceDateIso);
    expiry = { status, reason: status === "ACTION_REQUIRED" ? "Validité médicale expirée." : "Échéance médicale explicite.", dueDate: dated.expiryDateIso, sourceEventIds: [dated.id] };
  } else if (input.legacy.medicalDueDateIso) {
    const status = statusForExpiry(input.legacy.medicalDueDateIso, input.referenceDateIso);
    expiry = { status, reason: "Échéance médicale legacy exploitable sans date d’examen ni classe.", dueDate: input.legacy.medicalDueDateIso };
  } else {
    const latestMedical = [...medicalEvents].sort((left, right) => right.dateIso.localeCompare(left.dateIso))[0];
    expiry = latestMedical
      ? { status: "UNKNOWN", reason: "Événement médical connu sans échéance.", sourceEventIds: [latestMedical.id] }
      : { status: "UNKNOWN", reason: "Aucune échéance médicale connue." };
  }

  let level: QualificationRequirementResult;
  if (qualifying) {
    level = { status: "COMPLIANT", reason: `Niveau médical ${qualifying.medicalClass} compatible avec l’exigence ${requiredClass}.`, currentValue: qualifying.medicalClass, requiredValue: requiredClass, sourceEventIds: [qualifying.id] };
  } else {
    const knownLevels = medicalEvents.filter((event) => medicalLevel(event.medicalClass) !== null);
    const explicitlyInsufficient = requiredClass === "CLASS_2" && knownLevels.some((event) => event.medicalClass === "LAPL");
    level = explicitlyInsufficient
      ? { status: "ACTION_REQUIRED", reason: "Le niveau LAPL connu ne satisfait pas une exigence CLASS_2.", currentValue: "LAPL", requiredValue: "CLASS_2", sourceEventIds: knownLevels.filter(({ medicalClass }) => medicalClass === "LAPL").map(({ id }) => id) }
      : { status: "UNKNOWN", reason: "Niveau médical inconnu ou non comparable ; aucune classe n’est inventée.", requiredValue: requiredClass };
  }

  const overall: QualificationRequirementResult = expiry.status === "ACTION_REQUIRED" || level.status === "ACTION_REQUIRED"
    ? { status: "ACTION_REQUIRED", reason: "Validité ou niveau médical insuffisant.", dueDate: expiry.dueDate, sourceEventIds: level.sourceEventIds ?? expiry.sourceEventIds }
    : active(expiry.status) && level.status === "COMPLIANT"
      ? { status: expiry.status, reason: "Validité et niveau médical satisfaits.", dueDate: expiry.dueDate, sourceEventIds: qualifying ? [qualifying.id] : undefined }
      : { status: "UNKNOWN", reason: "Données insuffisantes pour conclure à la conformité médicale.", dueDate: expiry.dueDate, sourceEventIds: expiry.sourceEventIds };
  return { requiredClass, expiry, level, overall };
}

export function calculateProfessionalTrainingStatus(input: Readonly<{
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  type: ProfessionalTrainingType;
  referenceDateIso: string;
  trackWhenCommercialDisabled?: boolean;
}>): QualificationRequirementResult {
  if (!input.profile.commercialOperationsEnabled && input.trackWhenCommercialDisabled !== true) {
    return { status: "NON_APPLICABLE", reason: "Formation professionnelle non applicable lorsque l’activité commerciale est désactivée." };
  }
  const latest = [...input.events]
    .filter((event) => event.type === input.type && event.dateIso <= input.referenceDateIso)
    .sort((left, right) => right.dateIso.localeCompare(left.dateIso) || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  if (!latest) return { status: "UNKNOWN", reason: "Aucun événement de formation correspondant." };
  if (!latest.expiryDateIso) return { status: "UNKNOWN", reason: "Formation historisée sans échéance explicite ; aucune durée de validité n’est supposée.", sourceEventIds: [latest.id] };
  const status = statusForExpiry(latest.expiryDateIso, input.referenceDateIso);
  return { status, reason: status === "ACTION_REQUIRED" ? "Échéance de formation dépassée." : "Échéance explicite de la formation.", dueDate: latest.expiryDateIso, sourceEventIds: [latest.id] };
}
