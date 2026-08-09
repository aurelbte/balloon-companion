"use client";

import type { JournalFlight, JournalFlightPoint } from "../../lib/journalMockData";
import { useRecordedFlightJournalPoints } from "../../hooks/useRecordedFlightJournalPoints";

type JournalTraceThumbnailProps = {
  flight: JournalFlight;
  label: string;
};

const VIEWBOX_WIDTH = 152;
const VIEWBOX_HEIGHT = 72;
const PADDING = 9;

function tracePath(points: readonly JournalFlightPoint[]): string {
  if (points.length === 0) return "";
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.0001);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.0001);
  const scale = Math.min(
    (VIEWBOX_WIDTH - PADDING * 2) / longitudeSpan,
    (VIEWBOX_HEIGHT - PADDING * 2) / latitudeSpan,
  );
  const renderedWidth = longitudeSpan * scale;
  const renderedHeight = latitudeSpan * scale;
  const offsetX = (VIEWBOX_WIDTH - renderedWidth) / 2;
  const offsetY = (VIEWBOX_HEIGHT - renderedHeight) / 2;

  return points
    .map((point, index) => {
      const x = offsetX + (point.longitude - minLongitude) * scale;
      const y = offsetY + (maxLatitude - point.latitude) * scale;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function JournalTraceThumbnail({
  flight,
  label,
}: JournalTraceThumbnailProps) {
  const points = useRecordedFlightJournalPoints(flight);
  const path = tracePath(points);
  return (
    <svg
      className="h-full w-full"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={path} fill="none" stroke="rgb(3 10 19 / 75%)" strokeWidth="6" />
      <path
        d={path}
        fill="none"
        stroke="var(--bc-color-navigation-strong)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}
