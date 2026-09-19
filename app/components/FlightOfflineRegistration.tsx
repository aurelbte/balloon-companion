"use client";

import { useEffect } from "react";
import { serviceWorkerRegistrationReadiness } from "../lib/offlineReadiness";
import {
  initializeStorageResilience,
  refreshStorageEstimate,
  setOfflineReadiness,
} from "../lib/storageResilience";

export default function FlightOfflineRegistration() {
  useEffect(() => {
    initializeStorageResilience();
    const refresh = () => { void refreshStorageEstimate(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);

    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      setOfflineReadiness("UNAVAILABLE");
      return () => {
        window.removeEventListener("focus", refresh);
        window.removeEventListener("pageshow", refresh);
        document.removeEventListener("visibilitychange", visible);
      };
    }
    setOfflineReadiness("CHECKING");
    void navigator.serviceWorker.register("/flight-sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).then(serviceWorkerRegistrationReadiness)
      .then((state) => setOfflineReadiness(state))
      .catch(() => setOfflineReadiness("FAILED"));
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
