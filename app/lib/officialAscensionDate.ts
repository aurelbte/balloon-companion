/** Calendar dates only: never convert the logbook date through UTC or a timestamp. */
export function parseAscensionDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    ? `${year}-${month}-${day}` : null;
}

export function formatAscensionDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function openAscensionDatePicker(input: HTMLInputElement | null): void {
  if (!input) return;
  try {
    if (typeof input.showPicker === "function") { input.showPicker(); return; }
  } catch { /* Keep text focus; the adjacent native control remains directly clickable. */ }
}
