"use client";

import { useEffect, useState } from "react";
import { createEmptyFlightCompletionState } from "../lib/flightCompletion";
import {
  FLIGHT_COMPLETION_EVENT,
  loadFlightCompletionState,
} from "../lib/flightCompletionStorage";

export function useFlightCompletionState() {
  const [state, setState] = useState(createEmptyFlightCompletionState);

  useEffect(() => {
    const refresh = () => setState(loadFlightCompletionState());
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener(FLIGHT_COMPLETION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(FLIGHT_COMPLETION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return state;
}
