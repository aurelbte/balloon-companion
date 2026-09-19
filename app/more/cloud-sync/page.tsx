"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { inspectCloudSyncRuntimeControllerState, retryCloudSyncThroughRuntimeController, synchronizeCloudNowThroughRuntimeController } from "../../components/cloud/CloudSyncRuntime.tsx";
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
import { listPilotQualificationsProfileConflicts, type PilotQualificationsProfileConflict } from "../../lib/auth/guestToUserMigration.ts";
import type { QualificationProfile } from "../../lib/pilotQualifications.ts";
import { readPilotQualificationsProfileFromCloud } from "../../lib/pilotQualificationsCloudReader.ts";

const DOMAIN_LABEL: Record<string, string> = {
  "favorite-weather-place": "Lieu météo favori", "favorite-launch-site": "Terrain favori",
  balloon: "Ballon", flight: "Vol", "logbook-entry": "Ascension officielle", "balloon-document": "Document ballon", "pilot-qualifications": "Qualifications pilote",
};

function yesNo(value: boolean): string { return value ? "Oui" : "Non"; }
function list(value: readonly string[]): string { return value.length ? value.join(", ") : "Non renseigné"; }
function initialSituation(profile: QualificationProfile): string {
  const value = profile.declaredBplInitialSituation;
  return `${value.referenceDateIso ?? "Date non renseignée"} · expérience ${value.recentExperienceSatisfied === null ? "non renseignée" : yesNo(value.recentExperienceSatisfied)}`;
}
function commercialSituations(profile: QualificationProfile): string {
  if (!profile.declaredCommercialInitialSituations.length) return "Aucune";
  return profile.declaredCommercialInitialSituations.map(value => `${value.balloonClass.classId}${value.balloonClass.groupId ? ` ${value.balloonClass.groupId}` : ""} · ${value.referenceDateIso ?? "date non renseignée"} · récence ${value.recencySatisfied === null ? "non renseignée" : yesNo(value.recencySatisfied)}`).join(" ; ");
}
function QualificationProfileSummary({ profile }: Readonly<{ profile: QualificationProfile }>) {
  const rows = [
    ["Profil configuré", yesNo(profile.configured)], ["Licence", profile.licenceType ?? "Non renseignée"],
    ["Classes BPL", list(profile.bplBalloonClasses)], ["Groupe montgolfière", profile.hotAirBalloonGroupPrivilege ?? "Non renseigné"],
    ["Opérations commerciales", yesNo(profile.commercialOperationsEnabled)], ["Classes commerciales", list(profile.commercialBalloonClasses)],
    ["Groupe commercial", profile.commercialHotAirBalloonGroupPrivilege ?? "Non renseigné"], ["FI(B)", yesNo(profile.fiBEnabled)],
    ["FE(B)", yesNo(profile.feBEnabled)], ["Historique depuis", profile.historyCoverageStartDate ?? "Non renseigné"],
    ["Situation initiale BPL", initialSituation(profile)], ["Situations commerciales", commercialSituations(profile)],
  ] as const;
  return <dl className="mt-2 space-y-1 text-sm">{rows.map(([term, value]) => <div key={term} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2"><dt className="text-slate-600">{term}</dt><dd className="break-words font-medium text-slate-950">{value}</dd></div>)}</dl>;
}

export default function CloudSyncPage() {
  const auth = useBalloonAuth();
  const [issues, setIssues] = useState<readonly CloudSyncIssue[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [importDecisionBusy, setImportDecisionBusy] = useState(false);
  const [qualificationConflicts, setQualificationConflicts] = useState<readonly PilotQualificationsProfileConflict[]>([]);
  const [qualificationDetailsScope, setQualificationDetailsScope] = useState<string | null>(null);
  const [qualificationChoice, setQualificationChoice] = useState<Readonly<{ conflictId: string; strategy: "DEVICE" | "CLOUD" }> | null>(null);
  const [qualificationCloudState, setQualificationCloudState] = useState<"IDLE" | "LOADING" | "AVAILABLE" | "UNAVAILABLE">("IDLE");
  const scope = auth.user?.id ? `USER:${auth.user.id}` as const : null;
  const verdict = useCloudSyncVerdict(scope);
  const resolver = useMemo(() => scope && typeof window !== "undefined" ? createBrowserCrudConflictResolver({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }) : null, [scope]);

  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try { const next = resolver ? await resolver.listConflicts() : []; if (sequence === refreshSequence.current && getRuntimeDataScope() === scope) setIssues(next); } catch { /* The central verdict reports unreadable diagnostics. */ }
  }, [resolver, scope]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    window.addEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh);
    window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return () => { refreshSequence.current += 1; window.removeEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh); window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
  }, [refresh]);

  const qualificationCollisionKey = auth.localDataMigrationCollisions.filter(collision => collision.domain === "pilot-qualifications-profile" && collision.entityId === "singleton").map(collision => collision.source).sort().join(":");
  useEffect(() => {
    let active = true;
    if (!scope || !qualificationCollisionKey) { queueMicrotask(() => { if (active) { setQualificationConflicts([]); setQualificationDetailsScope(null); setQualificationCloudState("IDLE"); } }); return () => { active = false; }; }
    queueMicrotask(() => { if (active) { setQualificationConflicts([]); setQualificationDetailsScope(null); setQualificationCloudState("LOADING"); } });
    const userId = scope.slice(5), client = createBrowserSupabaseClient();
    void listPilotQualificationsProfileConflicts({
      userId, storage: window.localStorage, factory: window.indexedDB,
      readCloudQualifications: () => readPilotQualificationsProfileFromCloud({ client, userId }),
    })
      .then(conflicts => { if (active && getRuntimeDataScope() === scope) { setQualificationConflicts(conflicts); setQualificationDetailsScope(scope); setQualificationCloudState("AVAILABLE"); } })
      .catch(() => { if (active) setQualificationCloudState("UNAVAILABLE"); });
    return () => { active = false; };
  }, [qualificationCollisionKey, scope]);

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
      if (issue.entityType === "pilot-qualifications" && inspectCloudSyncRuntimeControllerState().scope === scope) await synchronizeCloudNowThroughRuntimeController();
    } catch { setActionError("La résolution n’a pas abouti. Réessayez lorsque la connexion est stable."); }
    finally { setResolving(null); }
  };
  const decideLocalImport = (decision: "MIGRATION_APPROVED" | "MIGRATION_DEFERRED") => {
    setImportDecisionBusy(true); setActionError(null);
    if (!auth.decideReviewedLocalDataImport(decision)) {
      setImportDecisionBusy(false);
      setActionError("La décision n’a pas pu être enregistrée sur cet appareil.");
    }
  };
  const confirmQualificationChoice = async () => {
    if (!qualificationChoice) return;
    setResolving(qualificationChoice.conflictId); setActionError(null);
    const resolved = await auth.resolvePilotQualificationsConflict(qualificationChoice.conflictId, qualificationChoice.strategy);
    if (resolved) {
      setQualificationConflicts(current => current.filter(conflict => conflict.id !== qualificationChoice.conflictId));
      setQualificationChoice(null);
    } else setActionError("Le conflit de qualifications n’a pas été résolu. Aucune donnée n’a été écartée.");
    setResolving(null);
  };

  const hasQualificationCollision = Boolean(qualificationCollisionKey);
  const visibleQualificationConflicts = qualificationDetailsScope === scope ? qualificationConflicts : [];
  const otherLocalCollisions = auth.localDataMigrationCollisions.filter(collision => collision.domain !== "pilot-qualifications-profile" || collision.entityId !== "singleton");

  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-8 pb-24">
    <Link href="/more" className="text-sm text-slate-600">← Plus</Link>
    <h1 className="mt-5 text-2xl font-semibold">Synchronisation Cloud</h1>
    {auth.localDataImportNotice && <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="status"><h2 className="font-semibold">Données locales sur cet appareil</h2><p className="mt-1 text-sm text-amber-950">{auth.localDataImportNotice}</p>{auth.localDataImportReviewPending && <><p className="mt-3 text-sm text-amber-950">Confirmez uniquement si ces données locales vous appartiennent.</p><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="button" disabled={importDecisionBusy} onClick={() => decideLocalImport("MIGRATION_APPROVED")}>Ce sont mes données — les rattacher</button><button className="rounded-xl border border-amber-500 bg-white px-4 py-2 disabled:opacity-50" type="button" disabled={importDecisionBusy} onClick={() => decideLocalImport("MIGRATION_DEFERRED")}>Ne pas importer</button></div></>}</section>}
    {visibleQualificationConflicts.map(conflict => <section key={conflict.id} className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-950" role="alert">
      <h2 className="font-semibold">Qualifications pilote différentes</h2>
      <p className="mt-1 text-sm text-slate-700">Choisissez explicitement la version à conserver. Les deux profils ne seront jamais fusionnés automatiquement.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="font-semibold">Sur cet appareil</h3><QualificationProfileSummary profile={conflict.deviceProfile} /></article>
        <article className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="font-semibold">Dans le Cloud</h3><QualificationProfileSummary profile={conflict.cloudProfile} /></article>
      </div>
      {!qualificationChoice || qualificationChoice.conflictId !== conflict.id ? <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="button" disabled={resolving !== null} onClick={() => setQualificationChoice({ conflictId: conflict.id, strategy: "DEVICE" })}>Garder les données de cet appareil</button>
        <button className="rounded-xl border border-slate-400 bg-white px-4 py-2 disabled:opacity-50" type="button" disabled={resolving !== null} onClick={() => setQualificationChoice({ conflictId: conflict.id, strategy: "CLOUD" })}>Garder les données du Cloud</button>
      </div> : <div className="mt-4 rounded-xl border border-amber-400 bg-white p-3">
        <p className="text-sm font-medium">Confirmer ce choix ? {qualificationChoice.strategy === "DEVICE" ? "Les qualifications Cloud seront remplacées lors de la prochaine synchronisation." : "Les qualifications locales importées seront écartées."}</p>
        <div className="mt-3 flex gap-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="button" disabled={resolving !== null} onClick={() => void confirmQualificationChoice()}>Confirmer</button><button className="rounded-xl border border-slate-400 bg-white px-4 py-2 disabled:opacity-50" type="button" disabled={resolving !== null} onClick={() => setQualificationChoice(null)}>Annuler</button></div>
      </div>}
    </section>)}
    {hasQualificationCollision && qualificationCloudState !== "AVAILABLE" && <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-950" role="status"><h2 className="font-semibold">Qualifications pilote différentes</h2><p className="mt-1 text-sm text-slate-700">{qualificationCloudState === "LOADING" ? "Lecture des qualifications Cloud…" : "La comparaison avec les qualifications Cloud nécessite une connexion. Aucune résolution n’est possible pour le moment."}</p></section>}
    {otherLocalCollisions.length > 0 && <section className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4" role="alert"><h2 className="font-semibold">Conflits de données locales</h2><p className="mt-1 text-sm text-red-900">Certaines données n’ont pas été rattachées automatiquement.</p><ul className="mt-3 list-disc pl-5 text-sm text-red-900">{otherLocalCollisions.map((collision, index) => <li key={`${collision.domain}:${collision.entityId}:${index}`}>{collision.reason === "DUPLICATE_REGISTRATION" ? `Immatriculation en double pour le ballon ${collision.entityId}` : `${collision.domain} — ${collision.entityId}`}</li>)}</ul>{otherLocalCollisions.some(collision => collision.reason === "DUPLICATE_REGISTRATION") && <Link className="mt-3 inline-block underline" href="/more/profile/balloons">Voir mes ballons</Link>}</section>}
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-slate-950">
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
