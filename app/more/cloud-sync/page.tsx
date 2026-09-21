"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { inspectCloudSyncRuntimeControllerState, retryCloudSyncThroughRuntimeController, synchronizeCloudNowThroughRuntimeController } from "../../components/cloud/CloudSyncRuntime.tsx";
import { getRuntimeDataScope } from "../../lib/auth/dataScopeRuntime.ts";
import { useCloudSyncVerdict } from "../../lib/useCloudSyncVerdict.ts";
import { CLOUD_SYNC_VERDICT_CHANGED_EVENT, CLOUD_SYNC_VERDICT_LABELS } from "../../lib/cloudSyncVerdict.ts";
import { CLOUD_SYNC_ISSUES_CHANGED_EVENT } from "../../lib/cloudSyncBrowser.ts";
import { createBrowserCrudConflictResolver } from "../../lib/crudConflictBrowser.ts";
import { createBrowserSupabaseClient } from "../../lib/supabase/client.ts";
import { loadFavoriteLaunchSites } from "../../lib/favoriteLaunchSites.ts";
import { loadFavoriteWeatherPlaces } from "../../lib/favoriteWeatherPlaces.ts";
import { loadBalloonRegistry } from "../../lib/balloonStorage.ts";
import type { AggregatedCloudSyncConflict } from "../../lib/crudConflictResolution.ts";
import { listPilotQualificationsProfileConflicts, type PilotQualificationsProfileConflict } from "../../lib/auth/guestToUserMigration.ts";
import type { QualificationProfile } from "../../lib/pilotQualifications.ts";
import { readPilotQualificationsProfileFromCloud } from "../../lib/pilotQualificationsCloudReader.ts";

const DOMAIN_LABEL: Record<string, string> = {
  "favorite-weather-place": "Lieu météo favori", "favorite-launch-site": "Terrain favori",
  balloon: "Ballon", flight: "Vol", "logbook-entry": "Ascension officielle", "balloon-document": "Document ballon", "pilot-qualifications": "Qualifications pilote",
};
const PROTECTED_PREFERENCE_LABEL: Record<string, string> = {
  "weather-preferences": "Préférences météo", "unit-preferences": "Préférences d’unités", "aviation-preferences": "Préférences aviation",
};
function shortId(value: string | null): string { return !value ? "inconnu" : value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`; }

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
  const [issues, setIssues] = useState<readonly AggregatedCloudSyncConflict[]>([]);
  const [issuesReadError, setIssuesReadError] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [importDecisionBusy, setImportDecisionBusy] = useState(false);
  const [qualificationConflicts, setQualificationConflicts] = useState<readonly PilotQualificationsProfileConflict[]>([]);
  const [qualificationDetailsScope, setQualificationDetailsScope] = useState<string | null>(null);
  const [qualificationChoice, setQualificationChoice] = useState<Readonly<{ conflictId: string; strategy: "DEVICE" | "CLOUD" }> | null>(null);
  const [qualificationCloudState, setQualificationCloudState] = useState<"IDLE" | "LOADING" | "AVAILABLE" | "UNAVAILABLE">("IDLE");
  const [preferenceChoice, setPreferenceChoice] = useState<Readonly<{ entityType: string; strategy: "LOCAL" | "CLOUD" }> | null>(null);
  const [orphanedFlightChoice, setOrphanedFlightChoice] = useState<Readonly<{ entityId: string; mutationIds: readonly string[]; execute: () => Promise<unknown> }> | null>(null);
  const scope = auth.user?.id ? `USER:${auth.user.id}` as const : null;
  const verdict = useCloudSyncVerdict(scope);
  const resolver = useMemo(() => scope && typeof window !== "undefined" ? createBrowserCrudConflictResolver({ client: createBrowserSupabaseClient(), storage: window.localStorage, scope }) : null, [scope]);

  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const next = resolver ? await resolver.listConflicts() : [];
      if (sequence === refreshSequence.current && getRuntimeDataScope() === scope) { setIssues(next); setIssuesReadError(false); }
    } catch { if (sequence === refreshSequence.current && getRuntimeDataScope() === scope) setIssuesReadError(true); }
  }, [resolver, scope]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    window.addEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh);
    window.addEventListener(CLOUD_SYNC_VERDICT_CHANGED_EVENT, refresh);
    window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return () => { refreshSequence.current += 1; window.removeEventListener(CLOUD_SYNC_ISSUES_CHANGED_EVENT, refresh); window.removeEventListener(CLOUD_SYNC_VERDICT_CHANGED_EVENT, refresh); window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
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

  const label = (issue: AggregatedCloudSyncConflict) => {
    let name: string | undefined;
    if (issue.entityType === "favorite-launch-site") name = loadFavoriteLaunchSites().find(({ id }) => id === issue.entityId)?.name;
    if (issue.entityType === "favorite-weather-place") name = loadFavoriteWeatherPlaces().find(({ id }) => id === issue.entityId)?.name;
    if (issue.entityType === "balloon") name = loadBalloonRegistry().balloons.find(({ id }) => id === issue.entityId)?.registration;
    return `${DOMAIN_LABEL[issue.entityType] ?? "Donnée"}${name ? ` — ${name}` : ""}`;
  };
  const resolve = async (issue: AggregatedCloudSyncConflict, strategy: "LOCAL" | "SERVER" | "BUSINESS" | "FLIGHT_PAYLOAD") => {
    if (!resolver) return;
    setResolving(`${issue.entityType}:${issue.entityId}`); setActionError(null);
    try {
      if (strategy === "BUSINESS") await resolver.retryDuplicateRegistration(issue.entityId);
      else if (strategy === "FLIGHT_PAYLOAD") await resolver.reconcileBlockedFlight(issue.entityId);
      else if (strategy === "LOCAL") await resolver.resolveLocalWins(issue.entityType, issue.entityId);
      else await resolver.resolveServerWins(issue.entityType, issue.entityId);
      await refresh();
      if (issue.entityType === "pilot-qualifications" && inspectCloudSyncRuntimeControllerState().scope === scope) await synchronizeCloudNowThroughRuntimeController();
    } catch (error) { setActionError(strategy === "FLIGHT_PAYLOAD" && error instanceof Error ? error.message : "La résolution n’a pas abouti. Réessayez lorsque la connexion est stable."); }
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
  const protectedPreferenceChains = Object.keys(PROTECTED_PREFERENCE_LABEL).flatMap(entityType => {
    const members = issues.filter(issue => issue.entityType === entityType && issue.entityId === "singleton" && issue.lastErrorCode === "CONFLICT");
    return members.length ? [{ entityType, members }] : [];
  });
  const ordinaryIssues = issues.filter(issue => !protectedPreferenceChains.some(chain => chain.entityType === issue.entityType && issue.entityId === "singleton"));
  const resolveProtectedPreference = async () => {
    if (!resolver || !preferenceChoice) return;
    const key = `${preferenceChoice.entityType}:singleton`;
    setResolving(key); setActionError(null);
    try {
      if (preferenceChoice.strategy === "LOCAL") await resolver.resolveProtectedLocalWins(preferenceChoice.entityType);
      else await resolver.resolveProtectedCloudWins(preferenceChoice.entityType);
      setPreferenceChoice(null);
      await refresh();
      if (inspectCloudSyncRuntimeControllerState().scope === scope) await synchronizeCloudNowThroughRuntimeController();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "La résolution doit être réessayée.");
    } finally { setResolving(null); }
  };
  const prepareOrphanedFlightAbandonment = async (entityId: string) => {
    if (!resolver) return;
    setResolving(`flight:${entityId}`); setActionError(null);
    try {
      const prepared = await resolver.prepareOrphanedFlightAbandonment(entityId);
      if (!prepared.mutationIds.length) throw new Error("La demande bloquée n’est plus présente.");
      setOrphanedFlightChoice(prepared);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "La vérification locale n’a pas abouti.");
    } finally { setResolving(null); }
  };
  const confirmOrphanedFlightAbandonment = async () => {
    if (!orphanedFlightChoice) return;
    const key = `flight:${orphanedFlightChoice.entityId}`;
    setResolving(key); setActionError(null);
    try {
      await orphanedFlightChoice.execute();
      setOrphanedFlightChoice(null);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "L’abandon n’a pas abouti. Aucune réussite n’a été confirmée.");
    } finally { setResolving(null); }
  };

  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-8 pb-24">
    <Link href="/more" className="text-sm text-slate-600">← Plus</Link>
    <h1 className="mt-5 text-2xl font-semibold">Synchronisation Cloud</h1>
    {auth.localDataImportNotice && <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-950" role="status"><h2 className="font-semibold">Données locales sur cet appareil</h2><p className="mt-1 text-sm text-amber-950">{auth.localDataImportNotice}</p>{auth.localDataImportReviewPending && <><p className="mt-3 text-sm text-amber-950">Confirmez uniquement si ces données locales vous appartiennent.</p><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="button" disabled={importDecisionBusy} onClick={() => decideLocalImport("MIGRATION_APPROVED")}>Ce sont mes données — les rattacher</button><button className="rounded-xl border border-amber-600 bg-white px-4 py-2 text-slate-950 disabled:opacity-50" type="button" disabled={importDecisionBusy} onClick={() => decideLocalImport("MIGRATION_DEFERRED")}>Ne pas importer</button></div></>}</section>}
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
    {otherLocalCollisions.length > 0 && <section className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950" role="alert"><h2 className="font-semibold">Conflits de données locales</h2><p className="mt-1 text-sm text-red-900">Certaines données n’ont pas été rattachées automatiquement.</p><ul className="mt-3 list-disc pl-5 text-sm text-red-900">{otherLocalCollisions.map((collision, index) => <li key={`${collision.domain}:${collision.entityId}:${index}`}>{collision.reason === "DUPLICATE_REGISTRATION" ? `Immatriculation en double pour le ballon ${collision.entityId}` : `${collision.domain} — ${collision.entityId}`}</li>)}</ul>{otherLocalCollisions.some(collision => collision.reason === "DUPLICATE_REGISTRATION") && <Link className="mt-3 inline-block underline" href="/more/profile/balloons">Voir mes ballons</Link>}</section>}
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-slate-950">
      <h2 className="font-semibold">{verdict.checking ? "Vérification en cours…" : CLOUD_SYNC_VERDICT_LABELS[verdict.state]}</h2>
      <p className="mt-1 text-sm text-slate-600">{verdict.checking && verdict.reason !== "Vérification en cours…" ? `Dernier état connu : ${verdict.reason}` : verdict.reason}</p>
      {verdict.verifiedAt && <p>Dernière synchronisation vérifiée : {new Date(verdict.verifiedAt).toLocaleString("fr-FR")}</p>}
      {verdict.bootstrapAt && <p>Dernier bootstrap : {new Date(verdict.bootstrapAt).toLocaleString("fr-FR")}</p>}
      <p className="mt-2 text-sm">Périmètre : profil, préférences, favoris, ballons, vols finalisés, carnet, métadonnées documentaires et transferts de traces connus.</p>
      <p className="mt-2 text-sm">Fichiers des documents stockés uniquement sur cet appareil.</p>
      <p className="mt-1 text-sm">Live et Amis sont hors du périmètre Cloud Sync.</p>
      {(["ERROR", "PENDING", "UNVERIFIABLE"].includes(verdict.state) || actionError) && <><p className="mt-2 text-sm text-red-700">{actionError ?? "Vérifiez les détails du statut avant de réessayer."}</p><button className="mt-3 rounded-xl border px-4 py-2" type="button" onClick={retryCloudSyncThroughRuntimeController}>Réessayer</button></>}
      {verdict.state === "CONFLICT" && <p className="mt-2 text-sm text-amber-800">Résolvez le conflit ci-dessous avant de relancer la synchronisation.</p>}
    </section>
    {issuesReadError && <section className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-5 text-red-950" role="alert"><h2 className="font-semibold">Impossible de lire les détails du conflit</h2><p className="mt-1 text-sm">Le conflit reste conservé. Réessayez lorsque le stockage local est disponible.</p><button className="mt-3 rounded-xl border border-red-400 bg-white px-4 py-2" type="button" onClick={() => void refresh()}>Relire les conflits</button></section>}
    {issues.length > 0 && <section className="mt-5 space-y-3" aria-label="Conflits Cloud">
      <p className="text-sm text-slate-700">Des conflits nécessitent votre attention.</p>
      {protectedPreferenceChains.map(chain => { const key = `${chain.entityType}:singleton`; const choice = preferenceChoice?.entityType === chain.entityType ? preferenceChoice : null; return <article key={key} className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-slate-950">
        <h2 className="font-semibold">{PROTECTED_PREFERENCE_LABEL[chain.entityType]} — conflit de synchronisation</h2>
        <p className="mt-1 text-sm text-slate-900">{chain.members.length} ancienne{chain.members.length > 1 ? "s" : ""} version{chain.members.length > 1 ? "s sont" : " est"} en conflit.</p>
        <p className="mt-2 text-sm text-slate-800">Appareil : les réglages actuellement visibles ici. Cloud : les réglages actuellement enregistrés dans le Cloud.</p>
        {resolving === key ? <p className="mt-3 font-medium">Résolution en cours…</p> : choice ? <div className="mt-3 rounded-xl border border-amber-400 bg-white p-3">
          <p className="text-sm font-medium text-slate-950">Confirmer que vous souhaitez garder les préférences {choice.strategy === "LOCAL" ? "de cet appareil" : "du Cloud"} ?</p>
          <div className="mt-3 flex gap-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-white" onClick={() => void resolveProtectedPreference()}>Confirmer</button><button className="rounded-xl border border-slate-500 bg-white px-4 py-2 font-medium text-slate-950" onClick={() => setPreferenceChoice(null)}>Annuler</button></div>
        </div> : <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" disabled={resolving !== null} onClick={() => setPreferenceChoice({ entityType: chain.entityType, strategy: "LOCAL" })}>Garder les préférences de cet appareil</button>
          <button className="rounded-xl border border-slate-400 bg-white px-4 py-2 disabled:opacity-50" disabled={resolving !== null} onClick={() => setPreferenceChoice({ entityType: chain.entityType, strategy: "CLOUD" })}>Garder les préférences du Cloud</button>
        </div>}
      </article>; })}
      {ordinaryIssues.map((issue, index) => { const key = `${issue.entityType}:${issue.entityId}:${issue.mutationId ?? "diagnostic"}:${index}`; return <article key={key} className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-slate-950">
        <h2 className="font-semibold">{label(issue)}</h2>
        <p className="mt-1 break-words text-xs text-slate-600">{issue.entityType} · entité {shortId(issue.entityId)} · mutation {shortId(issue.mutationId)}</p>
        <p className="mt-1 text-xs text-slate-600">{issue.operation ?? "Opération inconnue"} · {issue.createdAt ? new Date(issue.createdAt).toLocaleString("fr-FR") : "date inconnue"} · révision de base {issue.baseRevision ?? "inconnue"}</p>
        {issue.integrity === "MUTATION_WITHOUT_DIAGNOSTIC" && <p className="mt-2 text-sm font-medium text-amber-900">Conflit local incomplet : la mutation existe sans diagnostic associé.</p>}
        {issue.integrity === "DIAGNOSTIC_WITHOUT_MUTATION" && <p className="mt-2 text-sm font-medium text-amber-900">Diagnostic de conflit sans mutation associée.</p>}
        {issue.resolution === "FLIGHT_PAYLOAD" ? <>
          <p className="mt-2 text-sm">Le payload historique de ce vol est invalide. Le vol local doit être relu avant toute nouvelle tentative.</p>
          <button className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "FLIGHT_PAYLOAD")}>Reconstruire depuis le vol local</button>
        </> : issue.resolution === "FLIGHT_ORPHAN" ? <>
          <p className="mt-2 font-medium">Vol local introuvable</p>
          <p className="mt-1 text-sm">Cette ancienne demande de synchronisation ne peut pas être reconstruite.</p>
          {orphanedFlightChoice?.entityId === issue.entityId ? <div className="mt-3 rounded-xl border border-amber-400 bg-white p-3">
            <p className="break-words text-sm font-medium">Confirmer l’abandon de {orphanedFlightChoice.mutationIds.length} mutation{orphanedFlightChoice.mutationIds.length > 1 ? "s" : ""} pour l’entité {issue.entityId} ?</p>
            <p className="mt-1 text-sm text-slate-700">Cette action ne recrée ni ne supprime un vol.</p>
            <div className="mt-3 flex gap-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" disabled={resolving !== null} onClick={() => void confirmOrphanedFlightAbandonment()}>Confirmer l’abandon</button><button className="rounded-xl border border-slate-500 bg-white px-4 py-2 font-medium text-slate-950 disabled:opacity-50" disabled={resolving !== null} onClick={() => setOrphanedFlightChoice(null)}>Annuler</button></div>
          </div> : <button className="mt-3 rounded-xl border border-amber-700 bg-white px-4 py-2 font-medium text-amber-950 disabled:opacity-50" disabled={resolving !== null} onClick={() => void prepareOrphanedFlightAbandonment(issue.entityId)}>Abandonner cette synchronisation</button>}
        </> : issue.businessCode === "DUPLICATE_REGISTRATION" ? <>
          <p className="mt-2 text-sm">Immatriculation déjà utilisée. Vérifiez le ballon concerné avant de réessayer l’envoi enregistré.</p>
          <Link className="mt-2 inline-block underline" href={loadBalloonRegistry().balloons.some(({ id }) => id === issue.entityId) ? `/more/profile/balloons/${encodeURIComponent(issue.entityId)}/edit` : "/more/profile/balloons"}>Modifier le ballon concerné</Link>
          {issue.resolution === "DUPLICATE_REGISTRATION" && <button className="ml-3 mt-3 rounded-xl border px-4 py-2 disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "BUSINESS")}>Réessayer après résolution</button>}
        </> : issue.resolution === "REVISION" ? <div className="mt-4 flex flex-wrap gap-2">
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "LOCAL")}>Garder ma version</button>
          <button className="rounded-xl border border-slate-400 bg-white px-4 py-2 disabled:opacity-50" disabled={resolving !== null} onClick={() => void resolve(issue, "SERVER")}>Utiliser la version Cloud</button>
        </div> : <p className="mt-2 text-sm">Aucune résolution automatique sûre n’est disponible. Le conflit est conservé pour intervention.</p>}
      </article>; })}
    </section>}
  </main>;
}
