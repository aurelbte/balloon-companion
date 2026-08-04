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
