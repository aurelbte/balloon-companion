import { addCalendarMonths, type QualificationRequirementStatus } from "./bplQualificationEngine.ts";
import type { OfficialAscension } from "./flightCompletion.ts";
import type { FeBAssessmentKind, QualificationEvent, QualificationProfile } from "./pilotQualifications.ts";

export type FeBValidityStatus = "VALID" | "ACTION_REQUIRED" | "EXPIRED" | "UNKNOWN" | "NOT_APPLICABLE";
export type FeBValidityResult = Readonly<{ status: FeBValidityStatus; certificateStatus: QualificationRequirementStatus | "EXPIRED"; issueDateIso: string | null; expiryDateIso: string | null; refresherStatus: QualificationRequirementStatus; refresherDateIso: string | null; supervisedAssessmentStatus: QualificationRequirementStatus; supervisedAssessmentDateIso: string | null; assessmentKind: FeBAssessmentKind | null; renewalRequired: boolean; certificateEventId?: string; refresherEventId?: string; supervisedAssessmentEventId?: string }>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | undefined): value is string => Boolean(value && ISO_DATE.test(value));
function usable(event: QualificationEvent, ascensionIds: ReadonlySet<string>): boolean { return !event.officialAscensionDeletedAt && (!event.officialAscensionId || ascensionIds.has(event.officialAscensionId)); }

export function evaluateFeBValidity(input: Readonly<{ profile: QualificationProfile; events: readonly QualificationEvent[]; ascensions: readonly OfficialAscension[]; referenceDateIso: string }>): FeBValidityResult {
  if (!validDate(input.referenceDateIso)) throw new TypeError("Date de référence invalide.");
  const base = { issueDateIso: null, expiryDateIso: null, refresherDateIso: null, supervisedAssessmentDateIso: null, assessmentKind: null, renewalRequired: false } as const;
  if (!input.profile.feBEnabled) return { ...base, status: "NOT_APPLICABLE", certificateStatus: "NON_APPLICABLE", refresherStatus: "NON_APPLICABLE", supervisedAssessmentStatus: "NON_APPLICABLE" };
  const ascensionIds = new Set(input.ascensions.map(({ id }) => id));
  const certificates = input.events.filter((event) => event.type === "FE_B_CERTIFICATE" && usable(event, ascensionIds)).sort((a, b) => b.dateIso.localeCompare(a.dateIso) || b.updatedAt.localeCompare(a.updatedAt));
  const certificate = certificates.find((event) => validDate(event.dateIso) && event.dateIso <= input.referenceDateIso);
  if (!certificate?.expiryDateIso) return { ...base, status: "UNKNOWN", certificateStatus: "UNKNOWN", refresherStatus: "UNKNOWN", supervisedAssessmentStatus: "UNKNOWN" };
  const issue = certificate.dateIso, expiry = certificate.expiryDateIso;
  if (expiry < issue) return { ...base, issueDateIso: issue, expiryDateIso: expiry, status: "UNKNOWN", certificateStatus: "UNKNOWN", refresherStatus: "UNKNOWN", supervisedAssessmentStatus: "UNKNOWN", certificateEventId: certificate.id };
  if (input.referenceDateIso > expiry) return { ...base, issueDateIso: issue, expiryDateIso: expiry, status: "EXPIRED", certificateStatus: "EXPIRED", refresherStatus: "ACTION_REQUIRED", supervisedAssessmentStatus: "ACTION_REQUIRED", renewalRequired: true, certificateEventId: certificate.id };
  const refresher = input.events.filter((event) => event.type === "FE_B_REFRESHER_COURSE" && usable(event, ascensionIds) && event.dateIso >= issue && event.dateIso <= expiry).sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
  const windowStart = addCalendarMonths(expiry, -24);
  const assessments = input.events.filter((event) => event.type === "FE_B_SUPERVISED_ASSESSMENT" && usable(event, ascensionIds) && validDate(event.dateIso) && event.dateIso >= windowStart && event.dateIso <= expiry);
  const assessment = assessments.filter((event) => event.assessmentKind && event.examiner?.name.trim()).sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
  const incompleteAssessment = assessments.some((event) => !event.assessmentKind || !event.examiner?.name.trim());
  const refresherStatus: QualificationRequirementStatus = refresher ? "COMPLIANT" : "ACTION_REQUIRED";
  const supervisedAssessmentStatus: QualificationRequirementStatus = assessment ? "COMPLIANT" : incompleteAssessment ? "UNKNOWN" : "ACTION_REQUIRED";
  const status: FeBValidityStatus = refresher && assessment ? "VALID" : incompleteAssessment && refresher ? "UNKNOWN" : "ACTION_REQUIRED";
  return { status, certificateStatus: "COMPLIANT", issueDateIso: issue, expiryDateIso: expiry, refresherStatus, refresherDateIso: refresher?.dateIso ?? null, supervisedAssessmentStatus, supervisedAssessmentDateIso: assessment?.dateIso ?? null, assessmentKind: assessment?.assessmentKind ?? null, renewalRequired: false, certificateEventId: certificate.id, ...(refresher ? { refresherEventId: refresher.id } : {}), ...(assessment ? { supervisedAssessmentEventId: assessment.id } : {}) };
}
