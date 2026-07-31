import styles from "../../journal/Journal.module.css";

type JournalChartPoint = { x: number; y: number };

type JournalChartProps = {
  title: string;
  unit: string;
  axisUnit: string;
  points: readonly JournalChartPoint[];
  color: string;
  yMaximum: number;
  yStep: number;
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
}: JournalChartProps) {
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const yTicks = ticksUntil(yMaximum, yStep).reverse();
  const regularXTicks = ticksUntil(Math.floor(maxX / 10) * 10, 10);
  const xTicks =
    regularXTicks.at(-1) === maxX
      ? regularXTicks
      : [...regularXTicks, maxX];
  const path = points
    .map((point, index) => {
      const x = 1.5 + (point.x / maxX) * 97;
      const y = 4 + (1 - Math.min(yMaximum, Math.max(0, point.y)) / yMaximum) * 92;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

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
        </div>
        <div className={styles.chartXAxis} aria-hidden="true">
          {xTicks.map((tick, index) => (
            <span key={tick} style={{ left: `${(tick / maxX) * 100}%` }}>
              {index === 0 || index === xTicks.length - 1 ? `${tick} min` : tick}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
