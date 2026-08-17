"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import styles from "../../journal/Journal.module.css";
import { buildJournalChartPath, buildJournalTimeAxis, formatJournalTimeTick, formatJournalTooltipTime, formatJournalTooltipValue, journalChartSampleTolerance, selectJournalChartPoint, type JournalChartPoint, type JournalChartSelection } from "../../lib/journalChart";

type JournalChartProps = {
  title: string;
  unit: string;
  axisUnit: string;
  points: readonly JournalChartPoint[];
  color: string;
  yMaximum: number;
  yStep: number;
  durationMinutes: number;
  tooltipLabel: string;
  tooltipUnavailableLabel: string;
  tooltipFractionDigits: number;
};

function ticksUntil(maximum: number, step: number): number[] {
  return Array.from(
    { length: Math.floor(maximum / step) + 1 },
    (_, index) => index * step,
  );
}

export default function JournalChart({
  title,
  unit,
  axisUnit,
  points,
  color,
  yMaximum,
  yStep,
  durationMinutes,
  tooltipLabel,
  tooltipUnavailableLabel,
  tooltipFractionDigits,
}: JournalChartProps) {
  const { maximumMinutes: maxX, ticks: xTicks } = useMemo(() => buildJournalTimeAxis(durationMinutes), [durationMinutes]);
  const yTicks = ticksUntil(yMaximum, yStep).reverse();
  const path = useMemo(() => buildJournalChartPath(points, maxX, yMaximum), [maxX, points, yMaximum]);
  const useHours = maxX >= 120;
  const toleranceMinutes = useMemo(() => journalChartSampleTolerance(points), [points]);
  const [selection, setSelection] = useState<JournalChartSelection | null>(null);
  const activePointer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const pendingTarget = useRef<number | null>(null);
  const scheduleSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    pendingTarget.current = ratio * maxX;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pendingTarget.current !== null) setSelection(selectJournalChartPoint(points, pendingTarget.current, toleranceMinutes));
    });
  }, [maxX, points, toleranceMinutes]);
  const clearSelection = useCallback(() => {
    pendingTarget.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setSelection(null);
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const selectedTime = selection?.timePoint.x ?? null;
  const selectedValue = selection?.valuePoint?.y ?? null;
  const cursorLeft = selectedTime === null ? 0 : 1.5 + selectedTime / maxX * 97;
  const markerTop = selectedValue === null ? null : 4 + (1 - Math.min(yMaximum, Math.max(0, selectedValue)) / yMaximum) * 92;
  const tooltipHorizontalClass = cursorLeft < 30 ? styles.chartTooltipStart : cursorLeft > 70 ? styles.chartTooltipEnd : styles.chartTooltipCenter;
  const tooltipVerticalClass = markerTop === null || markerTop > 44 ? styles.chartTooltipAbove : styles.chartTooltipBelow;

  return (
    <section className="rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-surface)] p-4 shadow-[var(--bc-shadow-xs)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-[var(--bc-text-muted)]">{unit}</span>
      </div>
      <div className={styles.chartGrid}>
        <div className={styles.chartYAxis} aria-hidden="true">
          {yTicks.map((tick, index) => (
            <span key={tick}>
              {tick.toLocaleString("fr-FR")}
              {index === 0 ? ` ${axisUnit}` : ""}
            </span>
          ))}
        </div>
        <div className={styles.chartPlot}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title} au cours du vol`}
          >
            {yTicks.map((tick) => {
              const y = 4 + (1 - tick / yMaximum) * 92;
              return (
                <line
                  key={`y-${tick}`}
                  x1="1.5"
                  x2="98.5"
                  y1={y}
                  y2={y}
                  stroke="var(--bc-border)"
                  strokeWidth="0.55"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {xTicks.map((tick) => {
              const x = 1.5 + (tick / maxX) * 97;
              return (
                <line
                  key={`x-${tick}`}
                  x1={x}
                  x2={x}
                  y1="4"
                  y2="96"
                  stroke="var(--bc-border)"
                  strokeWidth="0.45"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.75"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div
            className={styles.chartInteraction}
            style={{ color }}
            aria-label={`Explorer le graphique ${title}`}
            onPointerDown={(event) => {
              activePointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              scheduleSelection(event);
            }}
            onPointerMove={(event) => {
              if (activePointer.current === event.pointerId || event.pointerType === "mouse") scheduleSelection(event);
            }}
            onPointerUp={(event) => {
              if (activePointer.current !== event.pointerId) return;
              activePointer.current = null;
              clearSelection();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { activePointer.current = null; clearSelection(); }}
            onPointerLeave={(event) => { if (event.pointerType === "mouse" && activePointer.current === null) clearSelection(); }}
          >
            {selection && <>
              <span className={styles.chartCursor} style={{ left: `${cursorLeft}%` }} aria-hidden="true" />
              {markerTop !== null && <span className={styles.chartMarker} style={{ left: `${cursorLeft}%`, top: `${markerTop}%` }} aria-hidden="true" />}
              <output className={`${styles.chartTooltip} ${tooltipHorizontalClass} ${tooltipVerticalClass}`} style={{ left: `${cursorLeft}%`, top: markerTop === null ? "50%" : `${markerTop}%` }}>
                <strong>{tooltipLabel}</strong>
                <span>{selectedValue === null ? tooltipUnavailableLabel : formatJournalTooltipValue(selectedValue, axisUnit, tooltipFractionDigits)}</span>
                <strong>TEMPS DE VOL</strong>
                <span>{formatJournalTooltipTime(selection.timePoint.x)}</span>
              </output>
            </>}
          </div>
        </div>
        <div className={styles.chartXAxis} aria-hidden="true">
          {xTicks.map((tick, index) => (
            <span key={tick} style={{ left: `${(tick / maxX) * 100}%` }}>
              {formatJournalTimeTick(tick, useHours, index === xTicks.length - 1)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
