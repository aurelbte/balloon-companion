import { addCalendarMonths, type QualificationRequirementResult, type QualificationRequirementStatus } from "./bplQualificationEngine.ts";
import { officialAscensionFlightNature, type OfficialAscension } from "./flightCompletion.ts";
import type { QualificationEvent, QualificationProfile } from "./pilotQualifications.ts";

export const FI_B_RECENCY_RULES = Object.freeze({ instructionMonths: 36, instructionMinutes: 360, supervisedMonths: 108 });
export type FiBRecencyResult = Readonly<{ status: QualificationRequirementStatus; instructionMinutes36m: number; requiredInstructionMinutes: 360; instructionRequirementStatus: QualificationRequirementResult<number, number>; refresherRequirementStatus: QualificationRequirementResult<string>; supervisedInstructionRequirementStatus: QualificationRequirementResult<string>; sourceAscensionIds: readonly string[] }>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const inWindow = (date: string, start: string, end: string) => ISO_DATE.test(date) && date >= start && date <= end;
const historyCovers = (start: string, coverage: string | null | undefined) => coverage === undefined || Boolean(coverage && ISO_DATE.test(coverage) && coverage <= start);
function usableEvent(event: QualificationEvent, ascensionIds: ReadonlySet<string>): boolean { return !event.officialAscensionDeletedAt && (!event.officialAscensionId || ascensionIds.has(event.officialAscensionId)); }
function latest(events: readonly QualificationEvent[], type: QualificationEvent["type"], start: string, end: string, ascensionIds: ReadonlySet<string>) { return events.filter((event) => event.type === type && inWindow(event.dateIso, start, end) && usableEvent(event, ascensionIds)).sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0]; }

export function evaluateFiBRecency(input: Readonly<{ profile: QualificationProfile; events: readonly QualificationEvent[]; ascensions: readonly OfficialAscension[]; referenceDateIso: string; historyCoverageStartDate?: string | null }>): FiBRecencyResult {
  if (!ISO_DATE.test(input.referenceDateIso)) throw new TypeError("Date de référence invalide.");
  const na: QualificationRequirementResult = { status: "NON_APPLICABLE", reason: "Privilèges FI(B) non déclarés." };
  if (!input.profile.fiBEnabled) return { status: "NON_APPLICABLE", instructionMinutes36m: 0, requiredInstructionMinutes: 360, instructionRequirementStatus: na as QualificationRequirementResult<number, number>, refresherRequirementStatus: na as QualificationRequirementResult<string>, supervisedInstructionRequirementStatus: na as QualificationRequirementResult<string>, sourceAscensionIds: [] };
  const start36 = addCalendarMonths(input.referenceDateIso, -36), start108 = addCalendarMonths(input.referenceDateIso, -108);
  const ascensionIds = new Set(input.ascensions.map(({ id }) => id));
  const aocIds = new Set(input.events.filter((event) => event.type === "FI_B_ASSESSMENT_OF_COMPETENCE" && event.officialAscensionId && inWindow(event.dateIso, start36, input.referenceDateIso) && usableEvent(event, ascensionIds)).map((event) => event.officialAscensionId!));
  const recent = input.ascensions.filter((a) => inWindow(a.dateIso, start36, input.referenceDateIso));
  const credited = recent.filter((ascension) => ascension.regulatoryRole === "FI_B" || ascension.regulatoryRole === "FE_B" && (["SKILL_TEST", "PROFICIENCY_CHECK_BPL", "COMMERCIAL_PROFICIENCY_CHECK"].includes(officialAscensionFlightNature(ascension)) || aocIds.has(ascension.id)));
  const minutes = credited.reduce((sum, ascension) => sum + ascension.officialDurationMinutes, 0);
  const legacyPotential = recent.filter(({ regulatoryRole }) => regulatoryRole == null).reduce((sum, ascension) => sum + ascension.officialDurationMinutes, 0);
  const coverage = input.historyCoverageStartDate === undefined ? input.profile.historyCoverageStartDate : input.historyCoverageStartDate;
  const covers36 = historyCovers(start36, coverage), covers108 = historyCovers(start108, coverage);
  const instructionStatus: QualificationRequirementStatus = minutes >= 360 ? "COMPLIANT" : !covers36 && minutes + legacyPotential >= 360 ? "UNKNOWN" : "ACTION_REQUIRED";
  const instructionRequirementStatus: QualificationRequirementResult<number, number> = { status: instructionStatus, reason: instructionStatus === "COMPLIANT" ? "Au moins 6 h d’instruction admissible sur 36 mois." : instructionStatus === "UNKNOWN" ? "L’historique incomplet pourrait contenir les minutes manquantes." : "Moins de 6 h d’instruction admissible sur 36 mois.", currentValue: minutes, requiredValue: 360 };
  const refresher = latest(input.events, "FI_B_REFRESHER_TRAINING", start36, input.referenceDateIso, ascensionIds);
  const refresherStatus: QualificationRequirementStatus = refresher ? "COMPLIANT" : covers36 ? "ACTION_REQUIRED" : "UNKNOWN";
  const refresherRequirementStatus: QualificationRequirementResult<string> = { status: refresherStatus, reason: refresher ? "Remise à niveau instructeur valide sur 36 mois." : refresherStatus === "UNKNOWN" ? "Historique insuffisant pour confirmer la remise à niveau." : "Aucune remise à niveau instructeur valide sur 36 mois.", ...(refresher ? { currentValue: refresher.dateIso, sourceEventIds: [refresher.id] } : {}) };
  const supervised = latest(input.events, "FI_B_SUPERVISED_INSTRUCTION", start108, input.referenceDateIso, ascensionIds);
  const supervisedStatus: QualificationRequirementStatus = supervised ? "COMPLIANT" : covers108 ? "ACTION_REQUIRED" : "UNKNOWN";
  const supervisedInstructionRequirementStatus: QualificationRequirementResult<string> = { status: supervisedStatus, reason: supervised ? "Instruction FI(B) sous supervision valide sur 108 mois." : supervisedStatus === "UNKNOWN" ? "Historique insuffisant pour confirmer l’instruction sous supervision." : "Aucune instruction FI(B) sous supervision valide sur 108 mois.", ...(supervised ? { currentValue: supervised.dateIso, sourceEventIds: [supervised.id] } : {}) };
  const statuses = [instructionStatus, refresherStatus, supervisedStatus];
  const status: QualificationRequirementStatus = statuses.includes("ACTION_REQUIRED") ? "ACTION_REQUIRED" : statuses.includes("UNKNOWN") ? "UNKNOWN" : "COMPLIANT";
  return { status, instructionMinutes36m: minutes, requiredInstructionMinutes: 360, instructionRequirementStatus, refresherRequirementStatus, supervisedInstructionRequirementStatus, sourceAscensionIds: credited.map(({ id }) => id) };
}
