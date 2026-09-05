import { officialAscensionMovementCounts, type OfficialAscension, type PilotExperienceBalance } from "./flightCompletion.ts";
import type { BplBalloonClass, QualificationBalloonClass, QualificationEvent, QualificationProfile } from "./pilotQualifications.ts";
import { bplEventCredits, type BplEventCredit } from "./qualificationEventCredits.ts";
import { HOT_AIR_BALLOON_GROUPS, type HotAirBalloonGroup } from "./hotAirBalloonGroup.ts";

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
  provenance?: "DECLARED_BY_PILOT";
  declarationReferenceDateIso?: string;
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
  unqualifiedRegulatoryRoleAscensionIds: readonly string[];
  unqualifiedPotential: Readonly<{ officialDurationMinutes: number; takeoffs: number; landings: number }>;
}>;

export type BplHotAirGroupLimitation = Readonly<{
  status: "DETERMINED" | "UNKNOWN" | "NON_APPLICABLE";
  pilotPrivilegeGroup: HotAirBalloonGroup | null;
  creditGroup: HotAirBalloonGroup | null;
  exercisableGroup: HotAirBalloonGroup | null;
  sourceEventIds: readonly string[];
  reason: string;
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
  groupLimitation: BplHotAirGroupLimitation;
}>;

export type BplAdditionalClassExperienceResult = QualificationRequirementResult<number, number> & Readonly<{
  balloonClass: Readonly<{ classId: BplBalloonClass }>;
  explicitMinutes: number;
  legacyPotentialMinutes: number;
  sourceAscensionIds: readonly string[];
  unqualifiedRegulatoryRoleAscensionIds: readonly string[];
}>;

export type BplPrivilegesMaintenanceResult = Readonly<{
  overall: QualificationRequirementResult;
  referenceClass: Readonly<{ classId: BplBalloonClass }> | null;
  classResults: readonly Readonly<{
    balloonClass: Readonly<{ classId: BplBalloonClass }>;
    requirement: "BFCL_160_A" | "BFCL_160_B";
    result: QualificationRequirementResult;
    groupLimitation?: BplHotAirGroupLimitation;
  }>[];
  candidates: readonly Readonly<{
    referenceClass: Readonly<{ classId: BplBalloonClass }>;
    fullRequirement: BplMaintenanceResult;
    additionalClasses: readonly BplAdditionalClassExperienceResult[];
    status: "COMPLIANT" | "ACTION_REQUIRED" | "UNKNOWN";
  }>[];
  referenceRequirement: BplMaintenanceResult | null;
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

/** Échéance BFCL.160(a)(1)(ii), calculée depuis le dernier jour du mois du vol. */
export function trainingFlightDueDate(dateIso: string, months: number = BPL_REGULATORY_RULES.trainingFlightMonths): string {
  const parts = dateParts(dateIso);
  if (!parts || !Number.isInteger(months)) throw new TypeError("Date ISO ou nombre de mois invalide.");
  const [year, month] = parts;
  return addCalendarMonths(isoFromUtc(new Date(Date.UTC(year, month, 0))), months);
}

function categoryForClass(balloonClass: QualificationBalloonClass | undefined): OfficialAscension["category"] | null {
  if (!balloonClass) return null;
  if (balloonClass.classId === "HOT_AIR_BALLOON") return "Libre à air chaud";
  if (balloonClass.classId === "GAS_BALLOON") return "Libre à gaz";
  return null;
}

export function calculateDatedExperience(
  ascensions: readonly DatedBplAscension[],
  referenceDateIso: string,
  windowMonths = BPL_REGULATORY_RULES.recentExperienceMonths,
  balloonClass?: QualificationBalloonClass,
): DatedExperienceResult {
  if (!dateParts(referenceDateIso)) throw new TypeError("Date de référence invalide.");
  const windowStartIso = addCalendarMonths(referenceDateIso, -windowMonths);
  const targetCategory = categoryForClass(balloonClass);
  const included = ascensions.filter(({ dateIso, category }) => dateParts(dateIso) && dateIso >= windowStartIso && dateIso <= referenceDateIso
    && (!balloonClass || targetCategory !== null && category === targetCategory));
  const byCategory: Record<string, DatedExperienceByCategory> = {};
  let officialDurationMinutes = 0;
  let takeoffs = 0;
  let landings = 0;
  const fallbackIds: string[] = [];
  const sourceIds: string[] = [];
  const unqualifiedIds: string[] = [];
  const unqualifiedPotential = { officialDurationMinutes: 0, takeoffs: 0, landings: 0 };
  for (const ascension of included) {
    const durationEligible = ascension.regulatoryRole === "PIC" || ascension.regulatoryRole === "FI_B" || ascension.regulatoryRole === "FE_B";
    const movementsEligible = ascension.regulatoryRole === "PIC" || ascension.regulatoryRole === "DUAL";
    if (!durationEligible && !movementsEligible) {
      if (ascension.regulatoryRole == null) {
        const movements = officialAscensionMovementCounts(ascension);
        unqualifiedIds.push(ascension.id);
        unqualifiedPotential.officialDurationMinutes += ascension.officialDurationMinutes;
        unqualifiedPotential.takeoffs += movements.takeoffs;
        unqualifiedPotential.landings += movements.landings;
      }
      continue;
    }
    const movements = officialAscensionMovementCounts(ascension);
    const ascensionTakeoffs = movementsEligible ? movements.takeoffs : 0;
    const ascensionLandings = movementsEligible ? movements.landings : 0;
    if (movementsEligible && movements.legacyFallback) fallbackIds.push(ascension.id);
    if (durationEligible) officialDurationMinutes += ascension.officialDurationMinutes;
    takeoffs += ascensionTakeoffs;
    landings += ascensionLandings;
    sourceIds.push(ascension.id);
    const current = byCategory[ascension.category] ?? { officialDurationMinutes: 0, ascensions: 0, takeoffs: 0, landings: 0 };
    byCategory[ascension.category] = {
      officialDurationMinutes: current.officialDurationMinutes + (durationEligible ? ascension.officialDurationMinutes : 0),
      ascensions: current.ascensions + 1,
      takeoffs: current.takeoffs + ascensionTakeoffs,
      landings: current.landings + ascensionLandings,
    };
  }
  return {
    windowStartIso,
    windowEndIso: referenceDateIso,
    officialDurationMinutes,
    ascensions: sourceIds.length,
    takeoffs,
    landings,
    byCategory,
    sourceAscensionIds: sourceIds,
    legacyMovementFallbackAscensionIds: fallbackIds,
    unqualifiedRegulatoryRoleAscensionIds: unqualifiedIds,
    unqualifiedPotential,
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
  const dueDate = credit.requirement === "TRAINING_FLIGHT"
    ? trainingFlightDueDate(credit.dateIso, months)
    : addCalendarMonths(credit.dateIso, months);
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

function creditMatchesClass(credit: BplEventCredit, balloonClass: QualificationBalloonClass | undefined): boolean {
  return !balloonClass || credit.balloonClass?.classId === balloonClass.classId;
}

function satisfiesTimedRequirement(result: QualificationRequirementResult): boolean {
  return result.status === "COMPLIANT" || result.status === "UPCOMING" || result.status === "WARNING";
}

const GROUP_RANK: Readonly<Record<HotAirBalloonGroup, number>> = { A: 0, B: 1, C: 2, D: 3 };

function validCredit(credit: BplEventCredit, referenceDateIso: string): boolean {
  const dueDate = credit.requirement === "TRAINING_FLIGHT"
    ? trainingFlightDueDate(credit.dateIso)
    : addCalendarMonths(credit.dateIso, BPL_REGULATORY_RULES.proficiencyCheckMonths);
  return credit.dateIso <= referenceDateIso && timedStatus(dueDate, referenceDateIso) !== "ACTION_REQUIRED";
}

function bestGroupCredit(credits: readonly BplEventCredit[]): BplEventCredit | null {
  return [...credits].sort((left, right) => {
    const leftRank = HOT_AIR_BALLOON_GROUPS.includes(left.balloonClass?.groupId as HotAirBalloonGroup) ? GROUP_RANK[left.balloonClass!.groupId as HotAirBalloonGroup] : -1;
    const rightRank = HOT_AIR_BALLOON_GROUPS.includes(right.balloonClass?.groupId as HotAirBalloonGroup) ? GROUP_RANK[right.balloonClass!.groupId as HotAirBalloonGroup] : -1;
    return rightRank - leftRank || right.dateIso.localeCompare(left.dateIso);
  })[0] ?? null;
}

export function calculateBplMaintenance(input: Readonly<{
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  ascensions: readonly DatedBplAscension[];
  referenceDateIso: string;
  ascensionHistoryComplete: boolean;
  historyCoverageStartDate?: string | null;
  openingBalance?: PilotExperienceBalance;
  balloonClass?: QualificationBalloonClass;
}>): BplMaintenanceResult {
  const datedExperience = calculateDatedExperience(
    input.ascensions,
    input.referenceDateIso,
    BPL_REGULATORY_RULES.recentExperienceMonths,
    input.balloonClass,
  );
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
  const historyComplete = input.historyCoverageStartDate === undefined
    ? input.ascensionHistoryComplete
    : Boolean(dateParts(input.historyCoverageStartDate ?? "") && input.historyCoverageStartDate! <= datedExperience.windowStartIso);
  const experienceCompliant =
    currentExperience.officialDurationMinutes >= requiredExperience.officialDurationMinutes &&
    currentExperience.takeoffs >= requiredExperience.takeoffs &&
    currentExperience.landings >= requiredExperience.landings;
  const legacyCouldMakeExperienceCompliant = !experienceCompliant &&
    currentExperience.officialDurationMinutes + datedExperience.unqualifiedPotential.officialDurationMinutes >= requiredExperience.officialDurationMinutes &&
    currentExperience.takeoffs + datedExperience.unqualifiedPotential.takeoffs >= requiredExperience.takeoffs &&
    currentExperience.landings + datedExperience.unqualifiedPotential.landings >= requiredExperience.landings;
  const declaration = input.profile.declaredBplInitialSituation;
  const applicableDeclaration = !historyComplete && declaration && typeof declaration.recentExperienceSatisfied === "boolean" && Boolean(
    dateParts(declaration.referenceDateIso ?? "") && declaration.referenceDateIso! >= datedExperience.windowStartIso && declaration.referenceDateIso! <= input.referenceDateIso
  ) ? declaration : null;
  const recentExperience: BplMaintenanceResult["recentExperience"] = applicableDeclaration
    ? {
      status: applicableDeclaration.recentExperienceSatisfied ? "COMPLIANT" : "ACTION_REQUIRED",
      reason: applicableDeclaration.recentExperienceSatisfied
        ? "Condition d’expérience récente déclarée satisfaite. L’historique BC est incomplet ; cette déclaration est utilisée temporairement jusqu’à la couverture complète de la fenêtre."
        : "Condition d’expérience récente déclarée non satisfaite par le pilote.",
      currentValue: currentExperience,
      requiredValue: requiredExperience,
      provenance: "DECLARED_BY_PILOT",
      declarationReferenceDateIso: applicableDeclaration.referenceDateIso!,
    }
    : !historyComplete || legacyCouldMakeExperienceCompliant
    ? { status: "UNKNOWN", reason: "Historique récent à compléter pour couvrir toute la fenêtre de 24 mois.", currentValue: currentExperience, requiredValue: requiredExperience }
    : {
      status: experienceCompliant ? "COMPLIANT" : "ACTION_REQUIRED",
      reason: experienceCompliant ? "Seuils d’expérience datée atteints sur la fenêtre de 24 mois." : "Un ou plusieurs seuils d’expérience datée ne sont pas atteints sur 24 mois.",
      currentValue: currentExperience,
      requiredValue: requiredExperience,
    };

  const credits = bplEventCredits(input.events).filter((credit) => creditMatchesClass(credit, input.balloonClass));
  const trainingFlightFiB = eventRequirement(
    latestQualifiedCredit(credits, "TRAINING_FLIGHT", input.referenceDateIso),
    BPL_REGULATORY_RULES.trainingFlightMonths,
    input.referenceDateIso,
    "Aucun vol d’entraînement BPL avec FI(B) identifiable.",
  );
  const proficiencyCheckAlternative = eventRequirement(
    latestQualifiedCredit(credits, "PROFICIENCY_CHECK", input.referenceDateIso),
    BPL_REGULATORY_RULES.proficiencyCheckMonths,
    input.referenceDateIso,
    "Aucun contrôle de compétences BPL avec FE(B) identifiable.",
  );

  const standardPath = recentExperience.status === "COMPLIANT" && satisfiesTimedRequirement(trainingFlightFiB);
  const alternativePath = recentExperience.status !== "UNKNOWN" && !standardPath && satisfiesTimedRequirement(proficiencyCheckAlternative);
  const proficiencyCheckFeB: QualificationRequirementResult = recentExperience.status === "UNKNOWN"
    ? { status: "NON_APPLICABLE", reason: "Voie alternative non évaluée tant que l’historique récent est incomplet." }
    : standardPath
    ? { status: "NON_APPLICABLE", reason: "Voie alternative non nécessaire : la voie normale est satisfaite." }
    : proficiencyCheckAlternative;
  const profileIsBpl = input.profile.licenceType === "BPL";
  let overall: QualificationRequirementResult;
  if (!profileIsBpl) {
    overall = { status: "UNKNOWN", reason: "Le profil ne confirme pas une licence BPL." };
  } else if (recentExperience.status === "UNKNOWN") {
    overall = { status: "UNKNOWN", reason: "Historique récent à compléter avant de conclure au maintien BPL." };
  } else if (alternativePath || standardPath) {
    const sources = alternativePath ? proficiencyCheckFeB.sourceEventIds : trainingFlightFiB.sourceEventIds;
    overall = { status: "COMPLIANT", reason: alternativePath ? "Voie alternative par contrôle de compétences BPL avec FE(B)." : "Expérience récente et vol d’entraînement BPL avec FI(B) satisfaits.", ...(sources ? { sourceEventIds: sources } : {}), ...(!alternativePath && recentExperience.provenance ? { provenance: recentExperience.provenance, declarationReferenceDateIso: recentExperience.declarationReferenceDateIso } : {}) };
  } else {
    overall = { status: "ACTION_REQUIRED", reason: "Aucune voie de maintien BPL calculée n’est satisfaite." };
  }

  const hotAirTarget = input.balloonClass?.classId === "HOT_AIR_BALLOON";
  const admissibleGroupCredits = overall.status === "COMPLIANT"
    ? credits.filter((credit) => validCredit(credit, input.referenceDateIso) && (credit.requirement === "PROFICIENCY_CHECK" || recentExperience.status === "COMPLIANT"))
    : [];
  const retainedGroupCredit = bestGroupCredit(admissibleGroupCredits);
  const pilotPrivilegeGroup = hotAirTarget && input.profile.bplBalloonClasses?.includes("HOT_AIR_BALLOON")
    ? input.profile.hotAirBalloonGroupPrivilege ?? null
    : null;
  const creditGroup = hotAirTarget && HOT_AIR_BALLOON_GROUPS.includes(retainedGroupCredit?.balloonClass?.groupId as HotAirBalloonGroup)
    ? retainedGroupCredit!.balloonClass!.groupId as HotAirBalloonGroup
    : null;
  const exercisableGroup = pilotPrivilegeGroup && creditGroup
    ? GROUP_RANK[pilotPrivilegeGroup] <= GROUP_RANK[creditGroup] ? pilotPrivilegeGroup : creditGroup
    : null;
  const groupLimitation: BplMaintenanceResult["groupLimitation"] = !hotAirTarget
    ? { status: "NON_APPLICABLE", pilotPrivilegeGroup: null, creditGroup: null, exercisableGroup: null, sourceEventIds: [], reason: "Limitation A/B/C/D non applicable à cette classe." }
    : exercisableGroup
      ? { status: "DETERMINED", pilotPrivilegeGroup, creditGroup, exercisableGroup, sourceEventIds: retainedGroupCredit?.sourceEventIds ?? [], reason: `Groupes actuellement exerçables : A à ${exercisableGroup}.` }
      : { status: "UNKNOWN", pilotPrivilegeGroup, creditGroup, exercisableGroup: null, sourceEventIds: retainedGroupCredit?.sourceEventIds ?? [], reason: overall.status === "COMPLIANT" ? "Maintien BPL satisfait, mais groupe actuellement exerçable non déterminable." : "La limitation de groupe sera déterminée après satisfaction du maintien BPL." };

  return { recentExperience, trainingFlightFiB, proficiencyCheckFeB, overall, datedExperience, excludedOpeningBalance: input.openingBalance ?? null, groupLimitation };
}

export function calculateBplAdditionalClassExperience(input: Readonly<{
  ascensions: readonly DatedBplAscension[];
  referenceDateIso: string;
  balloonClass: Readonly<{ classId: BplBalloonClass }>;
  historyComplete: boolean;
}>): BplAdditionalClassExperienceResult {
  const windowStartIso = addCalendarMonths(input.referenceDateIso, -BPL_REGULATORY_RULES.recentExperienceMonths);
  const targetCategory = categoryForClass(input.balloonClass);
  let explicitMinutes = 0;
  let legacyPotentialMinutes = 0;
  const sourceAscensionIds: string[] = [];
  const unqualifiedRegulatoryRoleAscensionIds: string[] = [];
  for (const ascension of input.ascensions) {
    if (!dateParts(ascension.dateIso) || ascension.dateIso < windowStartIso || ascension.dateIso > input.referenceDateIso || ascension.category !== targetCategory) continue;
    if (["PIC", "DUAL", "FI_B", "FE_B"].includes(String(ascension.regulatoryRole))) {
      explicitMinutes += ascension.officialDurationMinutes;
      sourceAscensionIds.push(ascension.id);
    } else if (ascension.regulatoryRole == null) {
      legacyPotentialMinutes += ascension.officialDurationMinutes;
      unqualifiedRegulatoryRoleAscensionIds.push(ascension.id);
    }
  }
  const requiredMinutes = 180;
  const status = explicitMinutes >= requiredMinutes
    ? "COMPLIANT"
    : !input.historyComplete || explicitMinutes + legacyPotentialMinutes >= requiredMinutes
      ? "UNKNOWN"
      : "ACTION_REQUIRED";
  return {
    status,
    reason: status === "COMPLIANT"
      ? "Au moins 3 heures admissibles sont enregistrées dans cette classe sur 24 mois."
      : status === "UNKNOWN"
        ? "Les données disponibles ne permettent pas de conclure sur les 3 heures requises dans cette classe."
        : "Moins de 3 heures admissibles sont enregistrées dans cette classe sur 24 mois.",
    currentValue: explicitMinutes,
    requiredValue: requiredMinutes,
    balloonClass: input.balloonClass,
    explicitMinutes,
    legacyPotentialMinutes,
    sourceAscensionIds,
    unqualifiedRegulatoryRoleAscensionIds,
  };
}

export function calculateBplPrivilegesMaintenance(input: Readonly<{
  profile: QualificationProfile;
  events: readonly QualificationEvent[];
  ascensions: readonly DatedBplAscension[];
  referenceDateIso: string;
  ascensionHistoryComplete: boolean;
  historyCoverageStartDate?: string | null;
  openingBalance?: PilotExperienceBalance;
}>): BplPrivilegesMaintenanceResult {
  const classes = input.profile.bplBalloonClasses ?? [];
  if (classes.length === 0) {
    return {
      overall: { status: "UNKNOWN", reason: "Privilèges BPL à renseigner avant d’évaluer le maintien par classe." },
      referenceClass: null,
      classResults: [],
      candidates: [],
      referenceRequirement: null,
    };
  }
  const windowStartIso = addCalendarMonths(input.referenceDateIso, -BPL_REGULATORY_RULES.recentExperienceMonths);
  const historyComplete = input.historyCoverageStartDate === undefined
    ? input.ascensionHistoryComplete
    : Boolean(dateParts(input.historyCoverageStartDate ?? "") && input.historyCoverageStartDate! <= windowStartIso);
  const candidates = classes.map((classId) => {
    const referenceClass = { classId } as const;
    const fullRequirement = calculateBplMaintenance({ ...input, balloonClass: referenceClass });
    const additionalClasses = classes
      .filter((otherClassId) => otherClassId !== classId)
      .map((otherClassId) => calculateBplAdditionalClassExperience({ ascensions: input.ascensions, referenceDateIso: input.referenceDateIso, balloonClass: { classId: otherClassId }, historyComplete }));
    const allAdditionalCompliant = additionalClasses.every(({ status }) => status === "COMPLIANT");
    const status = fullRequirement.overall.status === "COMPLIANT" && allAdditionalCompliant
      ? "COMPLIANT"
      : fullRequirement.overall.status === "UNKNOWN" || additionalClasses.some(({ status: additionalStatus }) => additionalStatus === "UNKNOWN")
        ? "UNKNOWN"
        : "ACTION_REQUIRED";
    return { referenceClass, fullRequirement, additionalClasses, status } as const;
  });
  const selected = candidates.find(({ status }) => status === "COMPLIANT")
    ?? candidates.find(({ status }) => status === "UNKNOWN")
    ?? candidates[0]!;
  const overall: QualificationRequirementResult = selected.status === "COMPLIANT"
    ? { status: "COMPLIANT", reason: "Maintien BPL satisfait pour toutes les classes déclarées.", ...(selected.fullRequirement.overall.sourceEventIds ? { sourceEventIds: selected.fullRequirement.overall.sourceEventIds } : {}) }
    : selected.status === "UNKNOWN"
      ? { status: "UNKNOWN", reason: "Les données disponibles ne permettent pas de conclure pour toutes les classes BPL déclarées." }
      : { status: "ACTION_REQUIRED", reason: "Aucune combinaison ne satisfait le maintien pour toutes les classes BPL déclarées." };
  return {
    overall,
    referenceClass: selected.referenceClass,
    classResults: [
      { balloonClass: selected.referenceClass, requirement: "BFCL_160_A", result: selected.fullRequirement.overall, ...(selected.referenceClass.classId === "HOT_AIR_BALLOON" ? { groupLimitation: selected.fullRequirement.groupLimitation } : {}) },
      ...selected.additionalClasses.map((result) => ({ balloonClass: result.balloonClass, requirement: "BFCL_160_B" as const, result, ...(result.balloonClass.classId === "HOT_AIR_BALLOON" ? { groupLimitation: { status: "UNKNOWN" as const, pilotPrivilegeGroup: input.profile.hotAirBalloonGroupPrivilege ?? null, creditGroup: null, exercisableGroup: null, sourceEventIds: [], reason: "Aucun crédit hot-air BFCL.160(a) n'est utilisé dans cette combinaison." } } : {}) })),
    ],
    candidates,
    referenceRequirement: selected.fullRequirement,
  };
}
