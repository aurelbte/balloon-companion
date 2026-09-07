import type { OfficialAscension } from "./flightCompletion.ts";
import { addCalendarMonths, type QualificationRequirementResult, type QualificationRequirementStatus } from "./bplQualificationEngine.ts";
import type { QualificationBalloonClass, QualificationEvent, QualificationProfile } from "./pilotQualifications.ts";

export const COMMERCIAL_REGULATORY_RULES = Object.freeze({
  recencyDays: 180,
  picFlights: 3,
  supervisedPicFlightsInClass: 1,
  maintenanceMonths: 24,
  refresherTheoryMinutes: 6 * 60,
});

export const COMMERCIAL_UX_ALERT_THRESHOLDS = Object.freeze({ upcomingDays: 180, warningDays: 90 });

export const OFFICIAL_ASCENSION_CLASS_IDS = Object.freeze({
  "Libre à air chaud": "HOT_AIR_BALLOON",
  "Libre à gaz": "GAS_BALLOON",
} as const);

export type CommercialAscension = OfficialAscension & Readonly<{ balloonGroupId?: string }>;

export type CommercialQualificationResult = Readonly<{
  balloonClass: QualificationBalloonClass;
  initialAccess: QualificationRequirementResult;
  recency: QualificationRequirementResult;
  proficiencyCheckFeB: QualificationRequirementResult;
  refresherCourse: QualificationRequirementResult;
  operatorEquivalent: QualificationRequirementResult;
  maintenance: QualificationRequirementResult;
  overall: QualificationRequirementResult;
  recentExperience180dStatus: QualificationRequirementStatus;
  recentPicFlights180d: number;
  supervisedPicAlternativeStatus: QualificationRequirementStatus;
  maintenance24mStatus: QualificationRequirementStatus;
  proficiencyCheckStatus: QualificationRequirementStatus;
  refresherStatus: QualificationRequirementStatus;
  overallStatus: QualificationRequirementStatus;
}>;

const DAY_MS = 86_400_000;

function subtractDays(dateIso: string, days: number): string {
  const time = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(time)) throw new TypeError("Date de référence invalide.");
  return new Date(time - days * DAY_MS).toISOString().slice(0, 10);
}

function ascensionClass(ascension: CommercialAscension): QualificationBalloonClass | null {
  const classId = OFFICIAL_ASCENSION_CLASS_IDS[ascension.category];
  return classId ? { classId, ...(ascension.balloonGroupId ? { groupId: ascension.balloonGroupId } : {}) } : null;
}

function sameClass(candidate: QualificationBalloonClass | undefined | null, target: QualificationBalloonClass): boolean {
  if (!candidate?.classId || candidate.classId !== target.classId) return false;
  return !target.groupId || candidate.groupId === target.groupId;
}

function timedStatus(dueDate: string, referenceDateIso: string): QualificationRequirementStatus {
  const remaining = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${referenceDateIso}T00:00:00Z`)) / DAY_MS);
  if (remaining < 0) return "ACTION_REQUIRED";
  if (remaining <= COMMERCIAL_UX_ALERT_THRESHOLDS.warningDays) return "WARNING";
  if (remaining <= COMMERCIAL_UX_ALERT_THRESHOLDS.upcomingDays) return "UPCOMING";
  return "COMPLIANT";
}

function active(status: QualificationRequirementStatus): boolean {
  return status === "COMPLIANT" || status === "UPCOMING" || status === "WARNING";
}

function eventResult(event: QualificationEvent | null, referenceDateIso: string, reason: string): QualificationRequirementResult {
  if (!event) return { status: "ACTION_REQUIRED", reason };
  const dueDate = addCalendarMonths(event.dateIso, COMMERCIAL_REGULATORY_RULES.maintenanceMonths);
  const status = timedStatus(dueDate, referenceDateIso);
  return { status, reason: status === "ACTION_REQUIRED" ? "La période de 24 mois est dépassée." : "Événement commercial qualifié dans la période de 24 mois.", currentValue: event.dateIso, requiredValue: "24 mois", dueDate, sourceEventIds: [event.id] };
}

function latest(events: readonly QualificationEvent[]): QualificationEvent | null {
  return [...events].sort((left, right) => right.dateIso.localeCompare(left.dateIso) || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function calculateCommercialQualification(input: Readonly<{
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  ascensions: readonly CommercialAscension[];
  referenceDateIso: string;
  balloonClass: QualificationBalloonClass;
  ascensionHistoryComplete: boolean;
  historyCoverageStartDate?: string | null;
}>): CommercialQualificationResult {
  const notApplicable: QualificationRequirementResult = { status: "NON_APPLICABLE", reason: "Les opérations commerciales sont désactivées dans le profil." };
  if (!input.profile.commercialOperationsEnabled) {
    return { balloonClass: input.balloonClass, initialAccess: notApplicable, recency: notApplicable, proficiencyCheckFeB: notApplicable, refresherCourse: notApplicable, operatorEquivalent: notApplicable, maintenance: notApplicable, overall: notApplicable, recentExperience180dStatus: "NON_APPLICABLE", recentPicFlights180d: 0, supervisedPicAlternativeStatus: "NON_APPLICABLE", maintenance24mStatus: "NON_APPLICABLE", proficiencyCheckStatus: "NON_APPLICABLE", refresherStatus: "NON_APPLICABLE", overallStatus: "NON_APPLICABLE" };
  }
  if (!input.balloonClass.classId) {
    const unknown = { status: "UNKNOWN", reason: "Classe ballon concernée inconnue." } as const;
    return { balloonClass: input.balloonClass, initialAccess: unknown, recency: unknown, proficiencyCheckFeB: unknown, refresherCourse: unknown, operatorEquivalent: unknown, maintenance: unknown, overall: unknown, recentExperience180dStatus: "UNKNOWN", recentPicFlights180d: 0, supervisedPicAlternativeStatus: "UNKNOWN", maintenance24mStatus: "UNKNOWN", proficiencyCheckStatus: "UNKNOWN", refresherStatus: "UNKNOWN", overallStatus: "UNKNOWN" };
  }

  const issuances = input.events.filter((event) => event.type === "INITIAL_COMMERCIAL_ISSUANCE" && event.dateIso <= input.referenceDateIso && sameClass(event.balloonClass, input.balloonClass));
  const issuance = latest(issuances);
  const initialAccess: QualificationRequirementResult = issuance
    ? { status: "COMPLIANT", reason: "Délivrance initiale professionnelle renseignée pour cette classe.", currentValue: issuance.dateIso, sourceEventIds: [issuance.id] }
    : { status: "UNKNOWN", reason: "Délivrance initiale professionnelle non renseignée pour cette classe." };

  const startIso = subtractDays(input.referenceDateIso, COMMERCIAL_REGULATORY_RULES.recencyDays);
  const historyComplete = input.historyCoverageStartDate === undefined
    ? input.ascensionHistoryComplete
    : Boolean(/^\d{4}-\d{2}-\d{2}$/.test(input.historyCoverageStartDate ?? "") && input.historyCoverageStartDate! <= startIso);
  const recentAscensions = input.ascensions.filter((ascension) => ascension.dateIso >= startIso && ascension.dateIso <= input.referenceDateIso && ascensionClass(ascension));
  const recentPic = recentAscensions.filter((ascension) => ascension.regulatoryRole === "PIC");
  const recentInClass = recentPic.filter((ascension) => sameClass(ascensionClass(ascension), input.balloonClass));
  const supervisedEvidence = input.events.filter((event) =>
    event.type === "TRAINING_FLIGHT_BPL" && event.dateIso >= startIso && event.dateIso <= input.referenceDateIso &&
    event.instructor?.name.trim() && sameClass(event.balloonClass, input.balloonClass) &&
    event.officialAscensionId && recentInClass.some(({ id, supervisedByFiB }) => id === event.officialAscensionId && supervisedByFiB === true)
  );
  const threePicPath = recentPic.length >= COMMERCIAL_REGULATORY_RULES.picFlights && recentInClass.length >= 1;
  const supervisedPath = supervisedEvidence.length >= COMMERCIAL_REGULATORY_RULES.supervisedPicFlightsInClass;
  const declaration = input.profile.declaredCommercialInitialSituations?.find(({ balloonClass }) => sameClass(balloonClass, input.balloonClass));
  const applicableDeclaration = !historyComplete && typeof declaration?.recencySatisfied === "boolean" && Boolean(
    /^\d{4}-\d{2}-\d{2}$/.test(declaration.referenceDateIso ?? "") && declaration.referenceDateIso! >= startIso && declaration.referenceDateIso! <= input.referenceDateIso
  ) ? declaration : null;
  const recency: QualificationRequirementResult = threePicPath || supervisedPath
    ? { status: "COMPLIANT", reason: supervisedPath ? "Vol PIC dans la classe concernée sous supervision FI(B)." : "Trois vols PIC récents, dont au moins un dans la classe concernée.", currentValue: { picFlights: recentPic.length, flightsInClass: recentInClass.length, supervisedFlightsInClass: supervisedEvidence.length }, requiredValue: { picFlights: 3, flightsInClass: 1, supervisedFlightsInClass: 1 }, ...(supervisedEvidence.length ? { sourceEventIds: supervisedEvidence.map(({ id }) => id) } : {}) }
    : applicableDeclaration
      ? { status: applicableDeclaration.recencySatisfied ? "COMPLIANT" : "ACTION_REQUIRED", reason: applicableDeclaration.recencySatisfied ? "Récence déclarée satisfaite pour cette classe. L’historique BC est incomplet ; cette déclaration est utilisée temporairement jusqu’à la couverture complète de la fenêtre." : "Récence déclarée non satisfaite par le pilote pour cette classe.", currentValue: { picFlights: recentPic.length, flightsInClass: recentInClass.length }, requiredValue: { picFlights: 3, flightsInClass: 1 }, provenance: "DECLARED_BY_PILOT", declarationReferenceDateIso: applicableDeclaration.referenceDateIso! }
    : !historyComplete
      ? { status: "UNKNOWN", reason: "Historique récent à compléter pour couvrir toute la fenêtre de 180 jours.", currentValue: { picFlights: recentPic.length, flightsInClass: recentInClass.length }, requiredValue: { picFlights: 3, flightsInClass: 1 } }
      : { status: "ACTION_REQUIRED", reason: "Aucune voie de récence commerciale n’est satisfaite sur 180 jours.", currentValue: { picFlights: recentPic.length, flightsInClass: recentInClass.length }, requiredValue: { picFlights: 3, flightsInClass: 1 } };

  const checks = input.events.filter((event) => event.type === "COMMERCIAL_PROFICIENCY_CHECK" && event.dateIso <= input.referenceDateIso && event.examiner?.name.trim() && sameClass(event.balloonClass, input.balloonClass));
  const proficiencyCheckAlternative = eventResult(latest(checks), input.referenceDateIso, "Aucun contrôle de compétences professionnel avec FE(B) identifiable dans cette classe.");

  const byId = new Map(input.events.map((event) => [event.id, event]));
  const courses = input.events.filter((course) => {
    if (course.type !== "COMMERCIAL_REFRESHER_COURSE" || course.dateIso > input.referenceDateIso || !sameClass(course.balloonClass, input.balloonClass) || (course.theoryMinutes ?? 0) < COMMERCIAL_REGULATORY_RULES.refresherTheoryMinutes) return false;
    const courseWindowStart = addCalendarMonths(input.referenceDateIso, -COMMERCIAL_REGULATORY_RULES.maintenanceMonths);
    return course.relatedEventIds?.some((id) => {
      const training = byId.get(id);
      return training?.type === "TRAINING_FLIGHT_BPL" && training.dateIso >= courseWindowStart && training.dateIso <= input.referenceDateIso && training.instructor?.name.trim() && sameClass(training.balloonClass, input.balloonClass) && course.commercialQualifiedFiB === true;
    });
  });
  const course = latest(courses);
  const baseRefresherCourse = eventResult(course, input.referenceDateIso, "Aucun cours de remise à niveau commercial complet identifiable dans cette classe.");
  const trainingId = course?.relatedEventIds?.find((id) => {
      const training = byId.get(id);
      return training?.type === "TRAINING_FLIGHT_BPL" && training.instructor?.name.trim() && sameClass(training.balloonClass, input.balloonClass);
  });
  const refresherCourseAlternative = course && trainingId
    ? { ...baseRefresherCourse, sourceEventIds: [course.id, trainingId] }
    : baseRefresherCourse;

  const proficiencyCheckFeB = proficiencyCheckAlternative;
  const ambiguousCourse = input.events.some((candidate) => candidate.type === "COMMERCIAL_REFRESHER_COURSE" && candidate.dateIso <= input.referenceDateIso && sameClass(candidate.balloonClass, input.balloonClass) && (candidate.theoryMinutes ?? 0) >= 360 && candidate.commercialQualifiedFiB === undefined);
  const refresherCourse: QualificationRequirementResult = course ? refresherCourseAlternative : ambiguousCourse ? { status: "UNKNOWN", reason: "La qualification commerciale du FI(B) lié n’est pas renseignée." } : baseRefresherCourse;
  const operatorEquivalent: QualificationRequirementResult = { status: "UNKNOWN", reason: "Crédit de contrôle opérateur réservé pour une évolution future ; aucun type d’événement n’existe actuellement." };
  const maintenance: QualificationRequirementResult = initialAccess.status !== "COMPLIANT"
    ? { status: "UNKNOWN", reason: "Accès initial professionnel à renseigner avant le maintien." }
    : active(proficiencyCheckFeB.status) ? proficiencyCheckFeB
      : active(refresherCourse.status) ? refresherCourse
        : proficiencyCheckFeB.status === "UNKNOWN" || refresherCourse.status === "UNKNOWN" ? { status: "UNKNOWN", reason: "Preuves de maintien sur 24 mois insuffisantes." }
          : { status: "ACTION_REQUIRED", reason: "Aucune preuve de maintien sur 24 mois n’est satisfaite." };
  const overall: QualificationRequirementResult = initialAccess.status !== "COMPLIANT"
    ? { status: "UNKNOWN", reason: "Accès initial à l’activité professionnelle non renseigné." }
    : active(recency.status) && active(maintenance.status)
      ? { status: "COMPLIANT", reason: "Récence 180 jours et maintien 24 mois satisfaits.", sourceEventIds: [...(recency.sourceEventIds ?? []), ...(maintenance.sourceEventIds ?? [])], ...(recency.provenance ? { provenance: recency.provenance, declarationReferenceDateIso: recency.declarationReferenceDateIso } : {}) }
      : recency.status === "UNKNOWN" || maintenance.status === "UNKNOWN" ? { status: "UNKNOWN", reason: "Données insuffisantes pour confirmer la récence et le maintien professionnel." }
        : { status: "ACTION_REQUIRED", reason: recency.status === "ACTION_REQUIRED" ? "Récence commerciale de 180 jours non satisfaite." : "Maintien commercial de 24 mois non satisfait." };
  return { balloonClass: input.balloonClass, initialAccess, recency, proficiencyCheckFeB, refresherCourse, operatorEquivalent, maintenance, overall, recentExperience180dStatus: recency.status, recentPicFlights180d: recentPic.length, supervisedPicAlternativeStatus: supervisedPath ? "COMPLIANT" : historyComplete ? "ACTION_REQUIRED" : "UNKNOWN", maintenance24mStatus: maintenance.status, proficiencyCheckStatus: proficiencyCheckFeB.status, refresherStatus: refresherCourse.status, overallStatus: overall.status };
}
