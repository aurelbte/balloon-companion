"use client";
import { useEffect, useState } from "react";
import { CLOUD_SYNC_VERDICT_CHANGED_EVENT, CLOUD_SYNC_VERDICT_SOURCE, cloudSyncVerdictGeneration, invalidateCloudSyncVerdict, type CloudSyncVerdict } from "./cloudSyncVerdict.ts";
import { inspectBrowserCloudSyncVerdict, acceptBrowserCloudSyncVerdict } from "./cloudSyncVerdictBrowser.ts";
import { getRuntimeDataScope, getRuntimeAuthState, DATA_SCOPE_CHANGED_EVENT } from "./auth/dataScopeRuntime.ts";
import { CLOUD_SYNC_RUNTIME_CHANGED_EVENT, inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence } from "../components/cloud/CloudSyncRuntime.tsx";
import { CLOUD_SYNC_ISSUES_CHANGED_EVENT } from "./cloudSyncBrowser.ts";
import { SYNC_MUTATION_ENQUEUED_EVENT } from "./syncOutbox.ts";
import { FLIGHT_TRACK_QUEUE_CHANGED_EVENT } from "./flightTrackQueue.ts";
const unknown = (scope: string | null): CloudSyncVerdict => ({ state: getRuntimeAuthState() === "UNKNOWN" || scope?.startsWith("USER:") ? "UNVERIFIABLE" : "LOCAL_ONLY", scope, generation: cloudSyncVerdictGeneration(), verifiedAt: null, bootstrapAt: null, reason: "Vérification en cours…", checking: true });
export function useCloudSyncVerdict(scope: string | null): CloudSyncVerdict {
  const [verdict, setVerdict] = useState<CloudSyncVerdict>(() => unknown(scope));
  useEffect(() => {
    let disposed = false, sequence = 0;
    let stabilityRetries = 0;
    const refresh = () => {
      const request = ++sequence;
      setVerdict(current => current.scope === scope && current.generation === cloudSyncVerdictGeneration() ? { ...current, checking: true } : unknown(scope));
      void inspectBrowserCloudSyncVerdict(inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence).then(next => {
        if (!disposed && request === sequence && next.scope === scope && getRuntimeDataScope() === scope) {
          const accepted = acceptBrowserCloudSyncVerdict(next, inspectCloudSyncRuntimeControllerState, inspectCloudSyncTraceEvidence);
          if (accepted) {
            if (accepted.state === "UNVERIFIABLE" && accepted.reason.startsWith("Les sources ont changé") && stabilityRetries < 2) {
              stabilityRetries += 1; queueMicrotask(refresh); return;
            }
            stabilityRetries = 0; setVerdict({ ...accepted, checking: false });
          } else if (getRuntimeDataScope() === scope && stabilityRetries < 2) {
            stabilityRetries += 1; queueMicrotask(refresh);
          } else if (getRuntimeDataScope() === scope) {
            setVerdict(current => ({ ...current, state: current.state === "SYNCED" ? "UNVERIFIABLE" : current.state, scope, generation: cloudSyncVerdictGeneration(), verifiedAt: current.state === "SYNCED" ? null : current.verifiedAt, checking: false }));
          }
        }
      }).catch(() => { if (!disposed && request === sequence) setVerdict({ ...unknown(scope), reason: "Vérification locale impossible", checking: false }); });
    };
    const events = [CLOUD_SYNC_VERDICT_CHANGED_EVENT, CLOUD_SYNC_RUNTIME_CHANGED_EVENT, CLOUD_SYNC_ISSUES_CHANGED_EVENT, DATA_SCOPE_CHANGED_EVENT, SYNC_MUTATION_ENQUEUED_EVENT, FLIGHT_TRACK_QUEUE_CHANGED_EVENT, "online", "offline", "pageshow"];
    const crossTab = () => invalidateCloudSyncVerdict(false);
    let channel: BroadcastChannel | null = null;
    try { if (typeof window.BroadcastChannel === "function") channel = new window.BroadcastChannel(CLOUD_SYNC_VERDICT_CHANGED_EVENT); } catch { /* Local inspection remains available. */ }
    if (channel) channel.onmessage = event => { if (event.data?.source !== CLOUD_SYNC_VERDICT_SOURCE) crossTab(); };
    events.forEach(event => window.addEventListener(event, refresh));
    window.addEventListener("storage", crossTab);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => { disposed = true; channel?.close(); events.forEach(event => window.removeEventListener(event, refresh)); window.removeEventListener("storage", crossTab); document.removeEventListener("visibilitychange", visible); };
  }, [scope]);
  if (verdict.scope === scope && verdict.generation === cloudSyncVerdictGeneration()) return verdict;
  return verdict.scope === scope ? { ...unknown(scope), reason: verdict.reason, verifiedAt: verdict.verifiedAt, bootstrapAt: verdict.bootstrapAt } : unknown(scope);
}
