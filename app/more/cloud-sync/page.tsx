"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { retryCloudSyncThroughRuntimeController } from "../../components/cloud/CloudSyncRuntime.tsx";
import { getRuntimeDataScope } from "../../lib/auth/dataScopeRuntime.ts";
import { useCloudSyncVerdict } from "../../lib/useCloudSyncVerdict.ts";
import { CLOUD_SYNC_VERDICT_LABELS } from "../../lib/cloudSyncVerdict.ts";
import { CLOUD_SYNC_ISSUES_CHANGED_EVENT } from "../../lib/cloudSyncBrowser.ts";
import { createBrowserCrudConflictResolver } from "../../lib/crudConflictBrowser.ts";
import { createBrowserSupabaseClient } from "../../lib/supabase/client.ts";
import { loadFavoriteLaunchSites } from "../../lib/favoriteLaunchSites.ts";
import { loadFavoriteWeatherPlaces } from "../../lib/favoriteWeatherPlaces.ts";
import { loadBalloonRegistry } from "../../lib/balloonStorage.ts";
import type { CloudSyncIssue } from "../../lib/cloudSyncService.ts";

const DOMAIN_LABEL: Record<string, string> = {
  "favorite-weather-place": "Lieu météo favori", "favorite-launch-site": "Terrain favori",
  balloon: "Ballon", flight: "Vol", "logbook-entry": "Ascension officielle", "balloon-document": "Document ballon",
};

export default function CloudSyncPage() {
  const auth = useBalloonAuth();
  const [issues, setIssues] = useState<readonly CloudSyncIssue[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scope = auth.user?.id ? `USER:${auth.user.id}` as const : null;
  const verdict = useCloudSyncVerdict(scope);
  const resolver = useMemo(() => scope && typeof window !== "undefined" ? createBrowserCrudConflictResolver({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }) : null, [scope]);

  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setIssues([]);
    try { const next = resolver ? await resolver.listConflicts() : []; if (sequence === refreshSequence.current && getRuntimeDataScope() === scope) setIssues(next); } catch { /* The central verdict reports unreadable diagnostics. */ }
  }, [resolver, scope]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    window.addEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh);
    window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return () => { refreshSequence.current += 1; window.removeEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh); window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
  }, [refresh]);

  const label = (issue: CloudSyncIssue) => {
    let name: string | undefined;
    if (issue.entityType === "favorite-launch-site") name = loadFavoriteLaunchSites().find(({ id }) => id === issue.entityId)?.name;
    if (issue.entityType === "favorite-weather-place") name = loadFavoriteWeatherPlaces().find(({ id }) => id === issue.entityId)?.name;
    if (issue.entityType === "balloon") name = loadBalloonRegistry().balloons.find(({ id }) => id === issue.entityId)?.registration;
    return `${DOMAIN_LABEL[issue.entityType] ?? "Donnée"}${name ? ` — ${name}` : ""}`;
  };
  const resolve = async (issue: CloudSyncIssue, strategy: "LOCAL" | "SERVER" | "BUSINESS") => {
    if (!resolver) return;
    setResolving(`${issue.entityType}:${issue.entityId}`); setActionError(null);
    try {
      if (strategy === "BUSINESS") await resolver.retryDuplicateRegistration(issue.entityId);
      else if (strategy === "LOCAL") await resolver.resolveLocalWins(issue.entityType, issue.entityId);
      else await resolver.resolveServerWins(issue.entityType, issue.entityId);
      await refresh();
    } catch { setActionError("La résolution n’a pas abouti. Réessayez lorsque la connexion est stable."); }
    finally { setResolving(null); }
  };

  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-8 pb-24">
    <Link href="/more" className="text-sm text-slate-600">← Plus</Link>
    <h1 className="mt-5 text-2xl font-semibold">Synchronisation Cloud</h1>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{CLOUD_SYNC_VERDICT_LABELS[verdict.state]}</h2>
      <p className="mt-1 text-sm text-slate-600">{verdict.reason}</p>
      {verdict.verifiedAt && <p>Dernière synchronisation vérifiée : {new Date(verdict.verifiedAt).toLocaleString("fr-FR")}</p>}
      {verdict.bootstrapAt && <p>Dernier bootstrap : {new Date(verdict.bootstrapAt).toLocaleString("fr-FR")}</p>}
      <p className="mt-2 text-sm">Périmètre : profil, préférences, favoris, ballons, vols finalisés, carnet, métadonnées documentaires et transferts de traces connus.</p>
      <p className="mt-2 text-sm">Fichiers des documents stockés uniquement sur cet appareil.</p>
      <p className="mt-1 text-sm">Live et Amis sont hors du périmètre Cloud Sync.</p>
      {(["ERROR", "PENDING", "UNVERIFIABLE"].includes(verdict.state) || actionError) && <><p className="mt-2 text-sm text-red-700">{actionError ?? "Vérifiez les détails du statut avant de réessayer."}</p><button className="mt-3 rounded-xl border px-4 py-2" type="button" onClick={retryCloudSyncThroughRuntimeController}>Réessayer</button></>}
    </section>
    {issues.length > 0 && <section className="mt-5 space-y-3" aria-label="Conflits Cloud">
      <p className="text-sm text-slate-700">Des conflits nécessitent votre attention.</p>
      {issues.map((issue) => { const key = `${issue.entityType}:${issue.entityId}`; return <article key={key} className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="font-semibold">{label(issue)}</h2>
        {issue.kind === "BUSINESS_CONFLICT" ? <>
          <p className="mt-2 text-sm">Un ballon avec cette immatriculation existe déjà dans le compte Cloud. Vérifiez les fiches existantes. Après résolution, réessayez l’envoi enregistré.</p>
          <Link className="mt-2 inline-block underline" href="/more/profile/balloons">Voir mes ballons</Link>
          <button className="mt-3 rounded-xl border px-4 py-2 disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "BUSINESS")}>Réessayer après résolution</button>
        </> : <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "LOCAL")}>Garder ma version</button>
          <button className="rounded-xl border border-slate-400 bg-white px-4 py-2 disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "SERVER")}>Utiliser la version Cloud</button>
        </div>}
      </article>; })}
    </section>}
  </main>;
}
