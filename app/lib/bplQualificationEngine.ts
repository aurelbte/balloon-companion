import type { OfficialAscension, PilotExperienceBalance } from "./flightCompletion.ts";
import type { QualificationEvent, QualificationProfile } from "./pilotQualifications.ts";
import { bplEventCredits, type BplEventCredit } from "./qualificationEventCredits.ts";

export const BPL_REGULATORY_RULES = Object.freeze({
  recentExperienceMonths: 24,
  recentExperienceMinutes: 6 * 60,
  recentTakeoffs: 10,
  recentLandings: 10,
  trainingFlightMonths: 48,
  proficiencyCheckMonths: 24,
});

/** Seuils de présentation uniquement, sans effet sur la conformité réglementaire. */
export const BPL_UX_ALERT_THRESHOLDS = Object.freeze({ upcomingDays: 180, warningDays: 90 });

export type QualificationRequirementStatus = "COMPLIANT" | "UPCOMING" | "WARNING" | "ACTION_REQUIRED" | "UNKNOWN" | "NON_APPLICABLE";

export type QualificationRequirementResult<TCurrent = unknown, TRequired = unknown> = Readonly<{
  status: QualificationRequirementStatus;
  reason: string;
  currentValue?: TCurrent;
  requiredValue?: TRequired;
  dueDate?: string;
  sourceEventIds?: readonly string[];
}>;

/** Extension anticipée sans modifier le modèle carnet existant. */
export type DatedBplAscension = OfficialAscension & Readonly<{
  takeoffCount?: number;
  landingCount?: number;
}>;

export type DatedExperienceByCategory = Readonly<{
  officialDurationMinutes: number;
  ascensions: number;
  takeoffs: number;
  landings: number;
}>;

export type DatedExperienceResult = Readonly<{
  windowStartIso: string;
  windowEndIso: string;
  officialDurationMinutes: number;
  ascensions: number;
  takeoffs: number;
  landings: number;
  byCategory: Readonly<Record<string, DatedExperienceByCategory>>;
  sourceAscensionIds: readonly string[];
  legacyMovementFallbackAscensionIds: readonly string[];
}>;

export type BplMaintenanceResult = Readonly<{
  recentExperience: QualificationRequirementResult<
    Readonly<{ officialDurationMinutes: number; ascensions: number; takeoffs: number; landings: number }>,
    Readonly<{ officialDurationMinutes: number; takeoffs: number; landings: number }>
  >;
  trainingFlightFiB: QualificationRequirementResult;
  proficiencyCheckFeB: QualificationRequirementResult;
  overall: QualificationRequirementResult;
  datedExperience: DatedExperienceResult;
  excludedOpeningBalance: PilotExperienceBalance | null;
}>;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(dateIso: string): [number, number, number] | null {
  if (!ISO_DATE.test(dateIso)) return null;
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
    ? [year!, month!, day]
    : null;
}

function isoFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarMonths(dateIso: string, months: number): string {
  const parts = dateParts(dateIso);
  if (!parts || !Number.isInteger(months)) throw new TypeError("Date ISO ou nombre de mois invalide.");
  const [year, month, day] = parts;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoFromUtc(target);
}

function movementCount(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 0 ? value! : 1;
}

export function calculateDatedExperience(
  ascensions: readonly DatedBplAscension[],
  referenceDateIso: string,
  windowMonths = BPL_REGULATORY_RULES.recentExperienceMonths,
): DatedExperienceResult {
  if (!dateParts(referenceDateIso)) throw new TypeError("Date de référence invalide.");
  const windowStartIso = addCalendarMonths(referenceDateIso, -windowMonths);
  const included = ascensions.filter(({ dateIso }) => dateParts(dateIso) && dateIso >= windowStartIso && dateIso <= referenceDateIso);
  const byCategory: Record<string, DatedExperienceByCategory> = {};
  let officialDurationMinutes = 0;
  let takeoffs = 0;
  let landings = 0;
  const fallbackIds: string[] = [];
  for (const ascension of included) {
    const ascensionTakeoffs = movementCount(ascension.takeoffCount);
    const ascensionLandings = movementCount(ascension.landingCount);
    if (ascension.takeoffCount === undefined || ascension.landingCount === undefined) fallbackIds.push(ascension.id);
    officialDurationMinutes += ascension.officialDurationMinutes;
    takeoffs += ascensionTakeoffs;
    landings += ascensionLandings;
    const current = byCategory[ascension.category] ?? { officialDurationMinutes: 0, ascensions: 0, takeoffs: 0, landings: 0 };
    byCategory[ascension.category] = {
      officialDurationMinutes: current.officialDurationMinutes + ascension.officialDurationMinutes,
      ascensions: current.ascensions + 1,
      takeoffs: current.takeoffs + ascensionTakeoffs,
      landings: current.landings + ascensionLandings,
    };
  }
  return {
    windowStartIso,
    windowEndIso: referenceDateIso,
    officialDurationMinutes,
    ascensions: included.length,
    takeoffs,
    landings,
    byCategory,
    sourceAscensionIds: included.map(({ id }) => id),
    legacyMovementFallbackAscensionIds: fallbackIds,
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

function timedStatus(dueDate: string, referenceDateIso: string): QualificationRequirementStatus {
  const remainingDays = daysBetween(referenceDateIso, dueDate);
  if (remainingDays < 0) return "ACTION_REQUIRED";
  if (remainingDays <= BPL_UX_ALERT_THRESHOLDS.warningDays) return "WARNING";
  if (remainingDays <= BPL_UX_ALERT_THRESHOLDS.upcomingDays) return "UPCOMING";
  return "COMPLIANT";
}

function latestQualifiedCredit(
  credits: readonly BplEventCredit[],
  requirement: BplEventCredit["requirement"],
  referenceDateIso: string,
): BplEventCredit | null {
  return [...credits]
    .filter((credit) => credit.requirement === requirement && credit.dateIso <= referenceDateIso)
    .sort((left, right) => right.dateIso.localeCompare(left.dateIso))[0] ?? null;
}

function eventRequirement(
  credit: BplEventCredit | null,
  months: number,
  referenceDateIso: string,
  missingReason: string,
): QualificationRequirementResult {
  if (!credit) return { status: "UNKNOWN", reason: missingReason };
  const dueDate = addCalendarMonths(credit.dateIso, months);
  const status = timedStatus(dueDate, referenceDateIso);
  return {
    status,
    reason: status === "ACTION_REQUIRED" ? "La période calculée depuis le dernier événement est dépassée." : "Échéance calculée depuis le dernier événement qualifié.",
    currentValue: credit.dateIso,
    requiredValue: `${months} mois`,
    dueDate,
    sourceEventIds: credit.sourceEventIds,
  };
}

function satisfiesTimedRequirement(result: QualificationRequirementResult): boolean {
  return result.status === "COMPLIANT" || result.status === "UPCOMING" || result.status === "WARNING";
}

export function calculateBplMaintenance(input: Readonly<{
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  ascensions: readonly DatedBplAscension[];
  referenceDateIso: string;
  ascensionHistoryComplete: boolean;
  openingBalance?: PilotExperienceBalance;
}>): BplMaintenanceResult {
  const datedExperience = calculateDatedExperience(input.ascensions, input.referenceDateIso);
  const requiredExperience = {
    officialDurationMinutes: BPL_REGULATORY_RULES.recentExperienceMinutes,
    takeoffs: BPL_REGULATORY_RULES.recentTakeoffs,
    landings: BPL_REGULATORY_RULES.recentLandings,
  };
  const currentExperience = {
    officialDurationMinutes: datedExperience.officialDurationMinutes,
    ascensions: datedExperience.ascensions,
    takeoffs: datedExperience.takeoffs,
    landings: datedExperience.landings,
  };
  const experienceCompliant =
    currentExperience.officialDurationMinutes >= requiredExperience.officialDurationMinutes &&
    currentExperience.takeoffs >= requiredExperience.takeoffs &&
    currentExperience.landings >= requiredExperience.landings;
  const recentExperience: BplMaintenanceResult["recentExperience"] = !input.ascensionHistoryComplete
    ? { status: "UNKNOWN", reason: "Historique daté déclaré incomplet.", currentValue: currentExperience, requiredValue: requiredExperience }
    : {
      status: experienceCompliant ? "COMPLIANT" : "ACTION_REQUIRED",
      reason: experienceCompliant ? "Seuils d’expérience datée atteints sur la fenêtre de 24 mois." : "Un ou plusieurs seuils d’expérience datée ne sont pas atteints sur 24 mois.",
      currentValue: currentExperience,
      requiredValue: requiredExperience,
    };

  const credits = bplEventCredits(input.events);
  const trainingFlightFiB = eventRequirement(
    latestQualifiedCredit(credits, "TRAINING_FLIGHT", input.referenceDateIso),
    BPL_REGULATORY_RULES.trainingFlightMonths,
    input.referenceDateIso,
    "Aucun vol d’entraînement BPL avec FI(B) identifiable.",
  );
  const proficiencyCheckFeB = eventRequirement(
    latestQualifiedCredit(credits, "PROFICIENCY_CHECK", input.referenceDateIso),
    BPL_REGULATORY_RULES.proficiencyCheckMonths,
    input.referenceDateIso,
    "Aucun contrôle de compétences BPL avec FE(B) identifiable.",
  );

  const standardPath = recentExperience.status === "COMPLIANT" && satisfiesTimedRequirement(trainingFlightFiB);
  const alternativePath = satisfiesTimedRequirement(proficiencyCheckFeB);
  const profileIsBpl = input.profile.licenceType === "BPL";
  let overall: QualificationRequirementResult;
  if (!profileIsBpl) {
    overall = { status: "UNKNOWN", reason: "Le profil ne confirme pas une licence BPL." };
  } else if (alternativePath || standardPath) {
    const sources = alternativePath ? proficiencyCheckFeB.sourceEventIds : trainingFlightFiB.sourceEventIds;
    overall = { status: "COMPLIANT", reason: alternativePath ? "Voie alternative par contrôle de compétences BPL avec FE(B)." : "Expérience récente et vol d’entraînement BPL avec FI(B) satisfaits.", ...(sources ? { sourceEventIds: sources } : {}) };
  } else if (recentExperience.status === "UNKNOWN" || (trainingFlightFiB.status === "UNKNOWN" && proficiencyCheckFeB.status === "UNKNOWN")) {
    overall = { status: "UNKNOWN", reason: "Données insuffisantes pour conclure au maintien BPL." };
  } else {
    overall = { status: "ACTION_REQUIRED", reason: "Aucune voie de maintien BPL calculée n’est satisfaite." };
  }

  return { recentExperience, trainingFlightFiB, proficiencyCheckFeB, overall, datedExperience, excludedOpeningBalance: input.openingBalance ?? null };
}
