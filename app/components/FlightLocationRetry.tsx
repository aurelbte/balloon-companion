"use client";

import { useEffect } from "react";
import { retryIncompleteFlightLocations } from "../lib/flightLocationEnrichment";
import { DATA_SCOPE_CHANGED_EVENT } from "../lib/auth/dataScopeRuntime";

export default function FlightLocationRetry() {
  useEffect(() => {
    const retry = () => {
      if (document.visibilityState === "hidden") return;
      void retryIncompleteFlightLocations().catch(error => console.warn("[Flight locations] Reprise différée", error));
    };
    retry();
    window.addEventListener("online", retry);
    window.addEventListener(DATA_SCOPE_CHANGED_EVENT, retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);
  return null;
}
