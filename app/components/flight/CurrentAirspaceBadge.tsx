"use client";

import {
  type AirspaceBadgePresentation,
} from "../../lib/flightContext";
import { Chip } from "../../design-system";

interface CurrentAirspaceBadgeProps {
  presentation: AirspaceBadgePresentation;
  onOpenCurrentAirspace: () => void;
}

const TONE_STYLES = {
  blue: {
    color: "#dbeafe",
    border: "rgba(96, 165, 250, 0.72)",
    background: "rgba(15, 58, 112, 0.94)",
  },
  red: {
    color: "#fee2e2",
    border: "rgba(248, 113, 113, 0.78)",
    background: "rgba(105, 24, 36, 0.95)",
  },
  neutral: {
    color: "#f1f5f9",
    border: "rgba(203, 213, 225, 0.42)",
    background: "rgba(7, 17, 31, 0.93)",
  },
} as const;

export default function CurrentAirspaceBadge({
  presentation,
  onOpenCurrentAirspace,
}: CurrentAirspaceBadgeProps) {
  const tone = TONE_STYLES[presentation.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "max(16px, env(safe-area-inset-top))",
        right: "16px",
        zIndex: 20,
        display: "flex",
        maxWidth: "calc(100vw - 32px)",
        alignItems: "center",
        gap: "7px",
      }}
    >
      {presentation.interactive ? (
        <Chip
          onClick={onOpenCurrentAirspace}
          aria-label={presentation.ariaLabel}
          style={{
            maxWidth: "min(82vw, 440px)",
            overflow: "hidden",
            borderColor: tone.border,
            background: tone.background,
            color: tone.color,
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {presentation.label}
        </Chip>
      ) : (
        <div
          className="bc-chip"
          aria-label={presentation.ariaLabel}
          style={{
            maxWidth: "min(82vw, 440px)",
            overflow: "hidden",
            borderColor: tone.border,
            background: tone.background,
            color: tone.color,
            cursor: "default",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {presentation.label}
        </div>
      )}
    </div>
  );
}
