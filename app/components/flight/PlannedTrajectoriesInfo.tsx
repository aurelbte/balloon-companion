"use client";

import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { MODEL_LINE_STYLES } from "../../lib/trajectory/analysisStyles";
import type { ExportedPlannedTrajectory } from "../../lib/trajectory/weatherAnalysisStorage";

interface PlannedTrajectoriesInfoProps {
  trajectories: ExportedPlannedTrajectory[];
}

export default function PlannedTrajectoriesInfo({
  trajectories,
}: PlannedTrajectoriesInfoProps) {
  const [open, setOpen] = useState(false);
  const models = useMemo(
    () =>
      [...new Map(trajectories.map((item) => [item.modelId, item])).values()],
    [trajectories],
  );
  const altitudes = useMemo(
    () =>
      [
        ...new Map(
          trajectories.map((item) => [item.altitudeKey, item]),
        ).values(),
      ],
    [trajectories],
  );
  const forecastAtIso = trajectories[0]?.forecastAtIso;

  if (trajectories.length === 0) return null;

  return (
    <aside className="fixed bottom-[calc(205px+env(safe-area-inset-bottom))] left-3 z-20 text-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 min-w-11 items-center justify-center rounded-full border border-white/25 bg-[#07111fd9] px-3 shadow-xl backdrop-blur-md"
        aria-label="Trajectoires prévues"
        aria-expanded={open}
      >
        <Route size={19} />
        {open && (
          <span className="ml-2 text-[10px] font-black">
            {trajectories.length} prévue{trajectories.length > 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 w-56 rounded-xl border border-white/20 bg-[#07111feb] p-2.5 shadow-2xl backdrop-blur-md">
          <div className="grid gap-1">
            {models.map((model) => (
              <div
                key={model.modelId}
                className="flex items-center justify-between text-[10px] font-bold"
              >
                {model.modelLabel}
                <svg width="62" height="8" viewBox="0 0 62 8">
                  <line
                    x1="1"
                    y1="4"
                    x2="61"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={(
                      MODEL_LINE_STYLES[
                        model.modelId as keyof typeof MODEL_LINE_STYLES
                      ]?.dasharray ?? [1, 0]
                    ).join(" ")}
                  />
                </svg>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/15 pt-2">
            {altitudes.map((altitude) => (
              <span
                key={altitude.altitudeKey}
                className="text-[10px] font-bold"
              >
                <span style={{ color: altitude.color }}>●</span>{" "}
                {altitude.altitudeLabel}
              </span>
            ))}
          </div>
          {forecastAtIso && (
            <p className="mt-2 text-[9px] text-white/55">
              Prévision :{" "}
              {new Intl.DateTimeFormat("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(forecastAtIso))}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
