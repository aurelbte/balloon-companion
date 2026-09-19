export type ZonedDateTimeParts = Readonly<{ date: string; time: string }>;

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

function partsAt(timestamp: number, timeZone: string): ZonedDateTimeParts {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(timestamp).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function zonedDateTimeParts(value: string | number | Date, timeZone: string): ZonedDateTimeParts | null {
  if (!isValidTimeZone(timeZone)) return null;
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? partsAt(timestamp, timeZone) : null;
}

/** Returns null for invalid, nonexistent, or ambiguous civil times. */
export function civilDateTimeToIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !isValidTimeZone(timeZone)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const candidates: number[] = [];
  // IANA offsets are bounded by ±14 h; 15-minute steps cover current and historical zones used by the app.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = nominal - offsetMinutes * 60_000;
    const parts = partsAt(candidate, timeZone);
    if (parts.date === date && parts.time === time) candidates.push(candidate);
  }
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
}

export function formatInTimeZone(value: string | number | Date, timeZone?: string, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("fr-FR", { ...options, ...(timeZone && isValidTimeZone(timeZone) ? { timeZone } : {}) }).format(date);
}
