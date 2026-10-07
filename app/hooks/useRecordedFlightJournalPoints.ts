"use client";

import { useEffect, useState } from "react";
import type { JournalFlight, JournalFlightPoint } from "../lib/journalMockData";
import { FLIGHT_COMPLETION_EVENT, loadRecordedFlightForJournal } from "../lib/flightCompletionStorage";
import { recordedFlightPointsToJournalPoints } from "../lib/realFlightJournal";
import { getRuntimeDataScope, getRuntimeDataScopeGeneration } from "../lib/auth/dataScopeRuntime";
import { BrowserFlightTrackCloudService } from "../lib/flightTrackCloudBrowser";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { enqueueFlightTrackJob, IndexedDbFlightTrackQueueStorage } from "../lib/flightTrackQueue";

import { CLOUD_SYNC_VERDICT_CHANGED_EVENT } from "../lib/cloudSyncVerdict";

export type RecordedFlightJournalPointsState = Readonly<{
  points: readonly JournalFlightPoint[];
  trackState: "LOCAL" | "LOADING_CLOUD" | "CLOUD_OFFLINE" | "REMOTE_UNAVAILABLE" | "DOWNLOAD_ERROR" | "UNAVAILABLE";
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
  const [trackState, setTrackState] = useState<RecordedFlightJournalPointsState["trackState"]>(flight.points.length ? "LOCAL" : flight.origin === "REAL_GPS" ? "LOADING_CLOUD" : "UNAVAILABLE");

  useEffect(() => {
    setPoints(flight.points);
    if (flight.points.length > 0 || flight.origin !== "REAL_GPS") { setTrackState(flight.points.length ? "LOCAL" : "UNAVAILABLE"); return; }
    let active = true;
    let running = false;
    let pendingRead = false;
    let pendingDownload = false;
    const scope = getRuntimeDataScope();
    const generation = getRuntimeDataScopeGeneration();
    const current = () => active && getRuntimeDataScope() === scope && getRuntimeDataScopeGeneration() === generation;
    const sourceFlightId = (flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId ?? flight.id;
    setTrackState("LOADING_CLOUD");

    const read = async (allowDownload: boolean) => {
      let downloading = false;
      try {
        const recorded = await loadRecordedFlightForJournal(sourceFlightId);
        if (!current()) return;
        if (recorded?.points.length) {
          setPoints(recordedFlightPointsToJournalPoints(recorded));
          setTrackState("LOCAL");
          return;
        }
        // Sync notifications only reread local data; they must not create a retry loop.
        if (!allowDownload) return;
        if (!allowLazyCloudDownload) { setTrackState("UNAVAILABLE"); return; }
        if (!navigator.onLine) { setTrackState("CLOUD_OFFLINE"); return; }
        if (!scope?.startsWith("USER:")) { setTrackState("UNAVAILABLE"); return; }
        setTrackState("LOADING_CLOUD");
        downloading = true;
        const service = new BrowserFlightTrackCloudService(createBrowserSupabaseClient(), scope as `USER:${string}`);
        if (!recorded) {
          const restored = await service.restoreMissingLocalMetadata(sourceFlightId);
          if (!current()) return;
          if (restored === "ABSENT") { setTrackState("REMOTE_UNAVAILABLE"); return; }
        }
        await service.download(sourceFlightId);
        if (!current()) return;
        const hydrated = await loadRecordedFlightForJournal(sourceFlightId);
        if (!current()) return;
        if (hydrated?.points.length) {
          setPoints(recordedFlightPointsToJournalPoints(hydrated));
          setTrackState("LOCAL");
        } else {
          setTrackState("DOWNLOAD_ERROR");
        }
      } catch (error: unknown) {
        if (!current()) return;
        const remoteUnavailable = error instanceof Error && error.message === "REMOTE_TRACK_NOT_AVAILABLE";
        setTrackState(!navigator.onLine ? "CLOUD_OFFLINE" : remoteUnavailable ? "REMOTE_UNAVAILABLE" : "DOWNLOAD_ERROR");
        if (downloading && scope?.startsWith("USER:")) {
          const userScope = scope as `USER:${string}`;
          void enqueueFlightTrackJob(new IndexedDbFlightTrackQueueStorage(userScope), { scope: userScope, flightId: sourceFlightId, operation: "DOWNLOAD" }).catch(() => {});
        }
      }
    };
    const refresh = async (allowDownload: boolean) => {
      if (!current()) return;
      pendingRead = true;
      pendingDownload ||= allowDownload;
      if (running) return;
      running = true;
      try {
        while (pendingRead && current()) {
          const download = pendingDownload;
          pendingRead = false;
          pendingDownload = false;
          await read(download);
        }
      } finally { running = false; }
    };
    const onSync = () => { void refresh(false); };
    const onOnline = () => { void refresh(true); };
    window.addEventListener(FLIGHT_COMPLETION_EVENT, onSync);
    window.addEventListener(CLOUD_SYNC_VERDICT_CHANGED_EVENT, onSync);
    window.addEventListener("online", onOnline);
    void refresh(true);
    return () => {
      active = false;
      window.removeEventListener(FLIGHT_COMPLETION_EVENT, onSync);
      window.removeEventListener(CLOUD_SYNC_VERDICT_CHANGED_EVENT, onSync);
      window.removeEventListener("online", onOnline);
    };
  }, [flight, allowLazyCloudDownload]);

  return { points, trackState };
}
