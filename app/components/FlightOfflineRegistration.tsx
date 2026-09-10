"use client";

import { useEffect } from "react";

export default function FlightOfflineRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/flight-sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(() => {
      // First installation requires connectivity; retry on the next app opening.
    });
  }, []);
  return null;
}
