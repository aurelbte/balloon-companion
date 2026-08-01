export type HourlyGroundTemperature = {
  validTime: string;
  temperatureC: number;
  offsetMinutes: number;
};

export function hourlyTimeToTimestamp(value: string, timezone: string): number {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) || timezone === "UTC") return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const targetWallClock = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let timestamp = targetWallClock;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value: part }) => [type, part]));
    const displayedWallClock = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    timestamp += targetWallClock - displayedWallClock;
  }
  return timestamp;
}

/** Sélectionne l'échéance disponible la plus proche, en privilégiant le futur à égalité. */
export function selectNearestGroundTemperature(
  requestedTime: string,
  times: readonly unknown[],
  temperatures: readonly unknown[],
  timezone = "UTC",
): HourlyGroundTemperature | null {
  const requestedTimestamp = Date.parse(requestedTime);
  if (!Number.isFinite(requestedTimestamp)) return null;

  let selected: HourlyGroundTemperature | null = null;
  let selectedAbsoluteOffset = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const temperature = temperatures[index];
    if (typeof time !== "string" || typeof temperature !== "number" || !Number.isFinite(temperature)) return;
    const timestamp = hourlyTimeToTimestamp(time, timezone);
    if (!Number.isFinite(timestamp)) return;
    const offsetMinutes = (timestamp - requestedTimestamp) / 60_000;
    const absoluteOffset = Math.abs(offsetMinutes);
    if (
      absoluteOffset < selectedAbsoluteOffset ||
      (absoluteOffset === selectedAbsoluteOffset && offsetMinutes > (selected?.offsetMinutes ?? Number.NEGATIVE_INFINITY))
    ) {
      selected = { validTime: new Date(timestamp).toISOString(), temperatureC: temperature, offsetMinutes };
      selectedAbsoluteOffset = absoluteOffset;
    }
  });
  return selected;
}
