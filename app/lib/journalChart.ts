export type JournalChartPoint = { x: number; y: number | null };
export type JournalChartSelection = { timePoint: JournalChartPoint; valuePoint: JournalChartPoint | null };

const TIME_STEPS_MINUTES = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360];

export function buildJournalTimeAxis(rawDurationMinutes: number): { maximumMinutes: number; ticks: number[] } {
  const maximumMinutes = Math.max(1, Math.ceil(Number.isFinite(rawDurationMinutes) ? rawDurationMinutes : 0));
  const idealStep = maximumMinutes / 6;
  const step = TIME_STEPS_MINUTES.find((candidate) => candidate >= idealStep) ?? Math.ceil(idealStep / 60) * 60;
  const ticks = Array.from({ length: Math.ceil(maximumMinutes / step) }, (_, index) => index * step)
    .filter((tick) => tick < maximumMinutes);
  if (ticks.length > 1 && maximumMinutes - ticks.at(-1)! < Math.max(2, step * 0.4)) ticks.pop();
  return { maximumMinutes, ticks: [...ticks, maximumMinutes] };
}

export function formatJournalTimeTick(minutes: number, useHours: boolean, isLast: boolean): string {
  if (!useHours) return isLast ? `${Math.round(minutes)} min` : String(Math.round(minutes));
  if (minutes === 0) return "0";
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  const value = remainder === 0 ? `${hours} h` : `${hours} h ${String(remainder).padStart(2, "0")}`;
  return isLast ? value : value;
}

export function buildJournalChartPath(points: readonly JournalChartPoint[], maximumX: number, maximumY: number): string {
  let segmentOpen = false;
  return points.map((point) => {
    if (point.y === null || !Number.isFinite(point.y)) {
      segmentOpen = false;
      return "";
    }
    const x = 1.5 + (point.x / maximumX) * 97;
    const y = 4 + (1 - Math.min(maximumY, Math.max(0, point.y)) / maximumY) * 92;
    const command = segmentOpen ? "L" : "M";
    segmentOpen = true;
    return `${command}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

function nearestPointIndex(points: readonly JournalChartPoint[], targetMinutes: number): number {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x < targetMinutes) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  return Math.abs(points[low].x - targetMinutes) < Math.abs(points[low - 1].x - targetMinutes) ? low : low - 1;
}

export function journalChartSampleTolerance(points: readonly JournalChartPoint[]): number {
  const intervals = points.slice(1).flatMap((point, index) => {
    const interval = point.x - points[index].x;
    return interval > 0 && Number.isFinite(interval) ? [interval] : [];
  }).sort((left, right) => left - right);
  const median = intervals[Math.floor(intervals.length / 2)] ?? 0;
  return Math.min(0.25, Math.max(0.05, median * 2));
}

export function selectJournalChartPoint(points: readonly JournalChartPoint[], targetMinutes: number, toleranceMinutes = journalChartSampleTolerance(points)): JournalChartSelection | null {
  if (points.length === 0) return null;
  const timeIndex = nearestPointIndex(points, targetMinutes);
  const timePoint = points[timeIndex];
  if (timePoint.y !== null && Number.isFinite(timePoint.y)) return { timePoint, valuePoint: timePoint };
  let valuePoint: JournalChartPoint | null = null;
  for (let offset = 1; offset < points.length; offset += 1) {
    for (const index of [timeIndex - offset, timeIndex + offset]) {
      const candidate = points[index];
      if (!candidate || candidate.y === null || !Number.isFinite(candidate.y)) continue;
      if (Math.abs(candidate.x - timePoint.x) <= toleranceMinutes && (!valuePoint || Math.abs(candidate.x - timePoint.x) < Math.abs(valuePoint.x - timePoint.x))) valuePoint = candidate;
    }
    if (valuePoint) break;
  }
  return { timePoint, valuePoint };
}

export function formatJournalTooltipTime(elapsedMinutes: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMinutes * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} s` : `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

export function formatJournalTooltipValue(value: number, unit: string, fractionDigits: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${unit}`;
}
