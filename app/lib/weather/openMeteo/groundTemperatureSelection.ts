export type HourlyGroundTemperature = {
  validTime: string;
  temperatureC: number;
  offsetMinutes: number;
};

function asUtcTimestamp(value: string): number {
  const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return timestamp;
}

/** Sélectionne l'échéance disponible la plus proche, en privilégiant le futur à égalité. */
export function selectNearestGroundTemperature(
  requestedTime: string,
  times: readonly unknown[],
  temperatures: readonly unknown[],
): HourlyGroundTemperature | null {
  const requestedTimestamp = Date.parse(requestedTime);
  if (!Number.isFinite(requestedTimestamp)) return null;

  let selected: HourlyGroundTemperature | null = null;
  let selectedAbsoluteOffset = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const temperature = temperatures[index];
    if (typeof time !== "string" || typeof temperature !== "number" || !Number.isFinite(temperature)) return;
    const timestamp = asUtcTimestamp(time);
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
