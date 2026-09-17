"use client";
import { useEffect, useState } from "react";
import { CLOUD_SYNC_VERDICT_CHANGED_EVENT, CLOUD_SYNC_VERDICT_SOURCE, cloudSyncVerdictGeneration, invalidateCloudSyncVerdict, type CloudSyncVerdict } from "./cloudSyncVerdict.ts";
import { inspectBrowserCloudSyncVerdict, acceptBrowserCloudSyncVerdict } from "./cloudSyncVerdictBrowser.ts";
import { getRuntimeDataScope, getRuntimeAuthState, DATA_SCOPE_CHANGED_EVENT } from "./auth/dataScopeRuntime.ts";
import { CLOUD_SYNC_RUNTIME_CHANGED_EVENT, inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence } from "../components/cloud/CloudSyncRuntime.tsx";
import { CLOUD_SYNC_ISSUES_CHANGED_EVENT } from "./cloudSyncBrowser.ts";
import { SYNC_MUTATION_ENQUEUED_EVENT } from "./syncOutbox.ts";
import { FLIGHT_TRACK_QUEUE_CHANGED_EVENT } from "./flightTrackQueue.ts";
const unknown = (scope: string | null): CloudSyncVerdict => ({ state: getRuntimeAuthState() === "UNKNOWN" || scope?.startsWith("USER:") ? "UNVERIFIABLE" : "LOCAL_ONLY", scope, generation: cloudSyncVerdictGeneration(), verifiedAt: null, bootstrapAt: null, reason: "Vérification locale nécessaire" });
export function useCloudSyncVerdict(scope: string | null): CloudSyncVerdict {
  const [verdict, setVerdict] = useState<CloudSyncVerdict>(() => unknown(scope));
  useEffect(() => {
    let disposed = false, sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      setVerdict(unknown(scope)); // revoke success before any async reads
      void inspectBrowserCloudSyncVerdict(inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence).then(next => {
        if (!disposed && request === sequence && next.scope === scope && getRuntimeDataScope() === scope) {
          const accepted = acceptBrowserCloudSyncVerdict(next, inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence);
          if (accepted) setVerdict(accepted);
        }
      });
    };
    const events = [CLOUD_SYNC_VERDICT_CHANGED_EVENT, CLOUD_SYNC_RUNTIME_CHANGED_EVENT, CLOUD_SYNC_ISSUES_CHANGED_EVENT, DATA_SCOPE_CHANGED_EVENT, SYNC_MUTATION_ENQUEUED_EVENT, FLIGHT_TRACK_QUEUE_CHANGED_EVENT, "online", "offline", "pageshow"];
    const crossTab = () => invalidateCloudSyncVerdict(false);
    let channel: BroadcastChannel | null = null;
    try { if (typeof window.BroadcastChannel === "function") channel = new window.BroadcastChannel(CLOUD_SYNC_VERDICT_CHANGED_EVENT); } catch { /* Local inspection remains available. */ }
    if (channel) channel.onmessage = event => { if (event.data?.source !== CLOUD_SYNC_VERDICT_SOURCE) crossTab(); };
    events.forEach(event => window.addEventListener(event, refresh));
    window.addEventListener("storage", crossTab);
    window.addEventListener("visibilitychange", refresh);
    refresh();
    return () => { disposed = true; channel?.close(); events.forEach(event => window.removeEventListener(event, refresh)); window.removeEventListener("storage", crossTab); window.removeEventListener("visibilitychange", refresh); };
  }, [scope]);
  return verdict.scope === scope && verdict.generation === cloudSyncVerdictGeneration() ? verdict : unknown(scope);
}
