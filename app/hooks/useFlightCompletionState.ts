"use client";

import { useEffect, useState } from "react";
import { createEmptyFlightCompletionState, type FlightCompletionState } from "../lib/flightCompletion";
import {
  FLIGHT_COMPLETION_EVENT,
  loadFlightCompletionState,
} from "../lib/flightCompletionStorage";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";

export function useFlightCompletionState() {
  const [state, setState] = useState<FlightCompletionState>(() => ({
    ...createEmptyFlightCompletionState(),
    openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null },
  }));

  useEffect(() => {
    const refresh = () => setState(loadFlightCompletionState());
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener(FLIGHT_COMPLETION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(DATA_SCOPE_CHANGED_EVENT, refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(FLIGHT_COMPLETION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, refresh);
    };
  }, []);

  return state;
}
