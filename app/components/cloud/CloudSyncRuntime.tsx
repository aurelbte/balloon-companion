"use client";

import { useEffect } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { getRuntimeDataScope } from "../../lib/auth/dataScopeRuntime.ts";
import { createBrowserCloudSyncService } from "../../lib/cloudSyncBrowser.ts";
import { isAutomaticCloudSyncBlockedForControlledTest } from "../../lib/cloudSyncTestControl.ts";
import { createBrowserSupabaseClient } from "../../lib/supabase/client.ts";
import { SYNC_MUTATION_ENQUEUED_EVENT } from "../../lib/syncOutbox.ts";

const activePasses = new Map<string, Promise<unknown>>();
const pendingPasses = new Set<string>();

declare global {
  interface Window {
    __BC_CLOUD_SYNC_CONTROLLED_TEST__?: Readonly<{
      syncMutationById(mutationId: string): Promise<unknown>;
    }>;
  }
}

function controlledTestMode(): boolean {
  return typeof window !== "undefined" && isAutomaticCloudSyncBlockedForControlledTest(process.env.NODE_ENV, window.location.search);
}

function runPass(userId: string): void {
  const scope = `USER:${userId}` as const;
  if (controlledTestMode()) return;
  if (activePasses.has(scope)) { pendingPasses.add(scope); return; }
  if (typeof window === "undefined" || !navigator.onLine) return;
  const service = createBrowserCloudSyncService({
    client: createBrowserSupabaseClient(),
    storage: window.localStorage,
    scope,
    getScope: getRuntimeDataScope,
  });
  const pass = service.syncPendingMutations()
    .catch((error: unknown) => {
      if (process.env.NODE_ENV === "development") console.error("[cloudSync] Passe interrompue", error);
    })
    .finally(() => {
      activePasses.delete(scope);
      if (pendingPasses.delete(scope) && getRuntimeDataScope() === scope) runPass(userId);
    });
  activePasses.set(scope, pass);
}

export default function CloudSyncRuntime(): null {
  const auth = useBalloonAuth();

  useEffect(() => {
    if (auth.state !== "SIGNED_IN" || !auth.user) return;
    const userId = auth.user.id;
    const scope = `USER:${userId}` as const;
    const controlled = controlledTestMode();
    const controlledApi = controlled ? {
      syncMutationById: (mutationId: string) => createBrowserCloudSyncService({
        client: createBrowserSupabaseClient(),
        storage: window.localStorage,
        scope,
        getScope: getRuntimeDataScope,
      }).syncMutationById(mutationId),
    } : null;
    if (controlledApi) window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ = controlledApi;
    let debounceTimer: number | undefined;
    const schedule = (delay = 750) => {
      if (controlled) return;
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => runPass(userId), delay);
    };
    const online = () => schedule(0);
    const mutation = () => schedule();
    window.addEventListener("online", online);
    window.addEventListener(SYNC_MUTATION_ENQUEUED_EVENT, mutation);
    schedule(0);
    return () => {
      window.clearTimeout(debounceTimer);
      window.removeEventListener("online", online);
      window.removeEventListener(SYNC_MUTATION_ENQUEUED_EVENT, mutation);
      if (controlledApi && window.__BC_CLOUD_SYNC_CONTROLLED_TEST__ === controlledApi) delete window.__BC_CLOUD_SYNC_CONTROLLED_TEST__;
    };
  }, [auth.state, auth.user]);

  return null;
}
