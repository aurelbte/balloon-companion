import type { WeatherModelId } from "../weather/models.ts";

export type ModelLineStyle = {
  dasharray: readonly number[];
  preview: "solid" | "dashed" | "dotted" | "dash-dot";
};

export const MODEL_LINE_STYLES: Record<WeatherModelId, ModelLineStyle> = {
  arome: { dasharray: [1, 0], preview: "solid" },
  ecmwf: { dasharray: [3, 2], preview: "dashed" },
  gfs: { dasharray: [1, 2], preview: "dotted" },
  icon: { dasharray: [5, 2, 1, 2], preview: "dash-dot" },
  "arome-hd": { dasharray: [7, 2], preview: "dashed" },
  "icon-d2": { dasharray: [2, 1], preview: "dashed" },
  arpege: { dasharray: [8, 2, 2, 2], preview: "dash-dot" },
};

export const ALTITUDE_ANALYSIS_COLORS = {
  ground: "#3b82f6",
  100: "#22d3ee",
  300: "#22c55e",
  600: "#facc15",
  1000: "#f97316",
  1500: "#ef4444",
  2000: "#8b5cf6",
  2500: "#ec4899",
  3000: "#ffffff",
} as const;
