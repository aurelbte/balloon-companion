"use client";

import { useEffect, useState } from "react";
import type { JournalFlight, JournalFlightPoint } from "../lib/journalMockData";
import { loadRecordedFlightForJournal } from "../lib/flightCompletionStorage";
import { recordedFlightPointsToJournalPoints } from "../lib/realFlightJournal";
import { getRuntimeDataScope } from "../lib/auth/dataScopeRuntime";
import { BrowserFlightTrackCloudService } from "../lib/flightTrackCloudBrowser";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { enqueueFlightTrackJob, IndexedDbFlightTrackQueueStorage } from "../lib/flightTrackQueue";

export type RecordedFlightJournalPointsState = Readonly<{
  points: readonly JournalFlightPoint[];
  trackState: "LOCAL" | "LOADING_CLOUD" | "CLOUD_OFFLINE" | "UNAVAILABLE";
}>;

export function useRecordedFlightJournalPoints(
  flight: JournalFlight,
): readonly JournalFlightPoint[] {
  return useRecordedFlightJournalPointsState(flight, false).points;
}

export function useRecordedFlightJournalPointsState(
  flight: JournalFlight,
  allowLazyCloudDownload: boolean,
): RecordedFlightJournalPointsState {
  const [points, setPoints] = useState(flight.points);
  const [trackState, setTrackState] = useState<RecordedFlightJournalPointsState["trackState"]>(flight.points.length ? "LOCAL" : "UNAVAILABLE");

  useEffect(() => {
    setPoints(flight.points);
    if (flight.points.length > 0 || flight.origin !== "REAL_GPS") { setTrackState(flight.points.length ? "LOCAL" : "UNAVAILABLE"); return; }
    let active = true;
    const sourceFlightId = (flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId ?? flight.id;
    void loadRecordedFlightForJournal(sourceFlightId)
      .then(async (recorded) => {
        if (!active) return;
        if (recorded?.points.length) {
          setPoints(recordedFlightPointsToJournalPoints(recorded));
          setTrackState("LOCAL");
          return;
        }
        if (!allowLazyCloudDownload) { setTrackState("UNAVAILABLE"); return; }
        if (!navigator.onLine) { setTrackState("CLOUD_OFFLINE"); return; }
        const scope = getRuntimeDataScope();
        if (!scope?.startsWith("USER:")) { setTrackState("UNAVAILABLE"); return; }
        setTrackState("LOADING_CLOUD");
        await new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope as `USER:${string}`).download(sourceFlightId);
        const hydrated = await loadRecordedFlightForJournal(sourceFlightId);
        if (active && hydrated?.points.length) {
          setPoints(recordedFlightPointsToJournalPoints(hydrated));
          setTrackState("LOCAL");
        }
      })
      .catch((error: unknown) => {
        if (active) setTrackState(navigator.onLine ? "UNAVAILABLE" : "CLOUD_OFFLINE");
        const scope = getRuntimeDataScope();
        if (allowLazyCloudDownload && scope?.startsWith("USER:")) {
          const userScope = scope as `USER:${string}`;
          void enqueueFlightTrackJob(new IndexedDbFlightTrackQueueStorage(userScope), { scope: userScope, flightId: sourceFlightId, operation: "DOWNLOAD" }).catch(() => {});
        }
        if (process.env.NODE_ENV === "development") {
          console.error("[Journal] Relecture de la trace IndexedDB impossible", error);
        }
      });
    return () => { active = false; };
  }, [flight, allowLazyCloudDownload]);

  return { points, trackState };
}
