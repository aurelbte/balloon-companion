export type NormalizedTimeInput = { digits: string; time: string; error: string | null };

export function normalizeTimeInput(raw: string, finalize = false): NormalizedTimeInput {
  let digits = raw.replace(/\D/g, "").slice(0, 4);
  if ((raw.includes(":") || finalize) && digits.length === 3) digits = `0${digits}`;
  if (digits.length < 4) return { digits, time: "", error: null };
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  return hours <= 23 && minutes <= 59
    ? { digits, time: `${digits.slice(0, 2)}:${digits.slice(2, 4)}`, error: null }
    : { digits, time: "", error: "Heure invalide" };
}

export function validDurationMinutes(raw: string): boolean {
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isInteger(value) && value > 0;
}

export const VERTICAL_RATE_STEP_MPS = 0.5;
export const MAX_VERTICAL_RATE_MPS = 7;

export function clampVerticalRateMps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(
    MAX_VERTICAL_RATE_MPS,
    Math.max(0, Math.round(value / VERTICAL_RATE_STEP_MPS) * VERTICAL_RATE_STEP_MPS),
  );
}

export function stepVerticalRateMps(value: number, direction: -1 | 1): number {
  return clampVerticalRateMps(value + direction * VERTICAL_RATE_STEP_MPS);
}

export function optionalAscentRateMps(value: number): number | undefined {
  const normalized = clampVerticalRateMps(value);
  return normalized === 0 ? undefined : normalized;
}

export function optionalDescentRateMps(value: number): number | undefined {
  const normalized = clampVerticalRateMps(Math.abs(value));
  return normalized === 0 ? undefined : normalized;
}
