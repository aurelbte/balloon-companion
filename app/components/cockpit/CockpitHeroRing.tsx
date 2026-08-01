"use client";

import { useMemo } from "react";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import { calculatePilotOfficialTotals } from "../../lib/flightCompletion";
import HeroRing from "./HeroRing";
import type { HeroRingData } from "./types";

export default function CockpitHeroRing() {
  const state = useFlightCompletionState();
  const data = useMemo<HeroRingData>(() => {
    const totals = calculatePilotOfficialTotals(state);
    return {
      totalHours: totals.totalHoursExact ?? 0,
      displayHours: totals.displayHours === null ? "— h" : `${totals.displayHours} h`,
      flights: totals.ascensions ?? "—",
    };
  }, [state]);

  return <HeroRing data={data} />;
}
