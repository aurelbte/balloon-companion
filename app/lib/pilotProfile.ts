export const PILOT_PROFILE_VERSION = 1;
export type PilotUsualFunction = "Pilote" | "Élève";
export type PilotProfile = {
  version: typeof PILOT_PROFILE_VERSION;
  firstName: string;
  lastName: string;
  licenseNumber: string;
  usualFunction: PilotUsualFunction | null;
  flightTestDueDateIso: string;
  medicalDueDateIso: string;
};
export function createEmptyPilotProfile(): PilotProfile { return { version: PILOT_PROFILE_VERSION, firstName: "", lastName: "", licenseNumber: "", usualFunction: null, flightTestDueDateIso: "", medicalDueDateIso: "" }; }
function validIsoDate(value: unknown): value is string { return typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)); }
export function normalizePilotProfile(value: unknown): PilotProfile { if (!value || typeof value !== "object") return createEmptyPilotProfile(); const item = value as Partial<PilotProfile>; return { version: PILOT_PROFILE_VERSION, firstName: typeof item.firstName === "string" ? item.firstName.trim() : "", lastName: typeof item.lastName === "string" ? item.lastName.trim() : "", licenseNumber: typeof item.licenseNumber === "string" ? item.licenseNumber.trim().toUpperCase() : "", usualFunction: item.usualFunction === "Pilote" || item.usualFunction === "Élève" ? item.usualFunction : null, flightTestDueDateIso: validIsoDate(item.flightTestDueDateIso) ? item.flightTestDueDateIso : "", medicalDueDateIso: validIsoDate(item.medicalDueDateIso) ? item.medicalDueDateIso : "" }; }
export function remainingMonthsUntil(dateIso: string, now: Date): number | null { if (!dateIso) return null; const due = new Date(`${dateIso}T23:59:59`); if (!Number.isFinite(due.getTime())) return null; return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / (365.2425 / 12 * 24 * 60 * 60 * 1000))); }
export function formatProfileDate(dateIso: string): string | null { if (!dateIso) return null; const date = new Date(`${dateIso}T12:00:00`); return Number.isFinite(date.getTime()) ? date.toLocaleDateString("fr-FR") : null; }
