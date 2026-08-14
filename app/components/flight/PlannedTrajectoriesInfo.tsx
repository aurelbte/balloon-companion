"use client";

import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { FloatingAction, FloatingPanel } from "../../design-system";
import { MODEL_LINE_STYLES } from "../../lib/trajectory/analysisStyles";
import type { ExportedPlannedTrajectory } from "../../lib/trajectory/weatherAnalysisStorage";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { formatFlightAltitude } from "../../lib/unitPreferences";

interface PlannedTrajectoriesInfoProps {
  trajectories: readonly ExportedPlannedTrajectory[];
}

export default function PlannedTrajectoriesInfo({
  trajectories,
}: PlannedTrajectoriesInfoProps) {
  const units = useUnitPreferences();
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
      <FloatingAction
        onClick={() => setOpen((value) => !value)}
        className={open ? "w-auto grid-flow-col gap-2 px-3" : ""}
        style={open ? { width: "auto" } : undefined}
        aria-label="Trajectoires prévues"
        aria-expanded={open}
      >
        <Route size={19} />
        {open && (
          <span className="ml-2 text-[10px] font-black">
            {trajectories.length} prévue{trajectories.length > 1 ? "s" : ""}
          </span>
        )}
      </FloatingAction>
      {open && (
        <FloatingPanel className="mt-2 w-56">
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
                {altitude.altitudeKey === "ground" ? "Sol" : formatFlightAltitude(altitude.altitudeAmslM, units.flightInstruments.altitudeUnit)}
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
        </FloatingPanel>
      )}
    </aside>
  );
}
