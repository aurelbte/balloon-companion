"use client";

import { ChevronRight, RefreshCw, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import NavigationBar from "../components/NavigationBar";
import { synchronizeCloudNowThroughRuntimeController } from "../components/cloud/CloudSyncRuntime";
import { useBalloonAuth } from "../contexts/AuthContext";
import { AUTH_SIGN_IN_ROUTE, AUTH_SIGN_UP_ROUTE } from "../lib/auth/entry";
import { useCloudSyncVerdict } from "../lib/useCloudSyncVerdict.ts";
import { CLOUD_SYNC_VERDICT_LABELS } from "../lib/cloudSyncVerdict.ts";
import styles from "./More.module.css";

export default function MorePage() {
  const auth = useBalloonAuth();
  const [signingOut, setSigningOut] = useState(false);
  const verdict = useCloudSyncVerdict(auth.user?.id ? `USER:${auth.user.id}` : null);
  const [actionError, setActionError] = useState(false);
  const displayName = [auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(" ");

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
  }

  async function handleSynchronizeNow() {
    if (verdict.state === "SYNCING") return;
    setActionError(false);
    try { await synchronizeCloudNowThroughRuntimeController(); }
    catch { setActionError(true); }
  }

  return <main className={styles.screen}><div className={styles.layout}>
    <header><p className={styles.eyebrow}>Balloon Companion</p><h1 className={styles.title}>Plus</h1></header>
    <section className={styles.accountCard} aria-label="Compte Balloon Companion" aria-busy={auth.state === "UNKNOWN"}>
      <h2>Compte Balloon Companion</h2>
      {auth.state === "UNKNOWN" ? (
        <p className={styles.authLoading}>Vérification de la session…</p>
      ) : auth.state === "SIGNED_OUT" ? (
        <div className={styles.accountActions}>
          <Link href={AUTH_SIGN_UP_ROUTE}>Créer un compte</Link>
          <Link href={AUTH_SIGN_IN_ROUTE}>Se connecter</Link>
          <button type="button" onClick={auth.activateGuestMode}>Continuer sans compte</button>
        </div>
      ) : (
        <div className={styles.accountIdentity}>
          {displayName && <strong>{displayName}</strong>}
          <span>{auth.user?.email}</span>
          <em>{auth.state === "OFFLINE_SESSION" ? "Hors ligne" : "Connecté"}</em>
          <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
            {signingOut ? "Déconnexion…" : "Déconnexion"}
          </button>
        </div>
      )}
    </section>
    <Link href="/more/profile" className={styles.card}><div><h2>Profil pilote</h2><p>Expérience et informations du pilote</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/friends" className={styles.card}><Users size={20} aria-hidden="true" /><div className={styles.cardContent}><h2>Amis</h2><p>Demandes et contacts Balloon Companion</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/profile/balloons" className={styles.card}><div><h2>Mes ballons</h2><p>Matériel utilisé dans Balloon Companion</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/settings" className={styles.card}><div><h2>Réglages</h2><p>Comportement de l’application</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <section className={styles.syncNow} aria-live="polite">
      <button type="button" disabled={verdict.state === "SYNCING" || auth.state !== "SIGNED_IN"} onClick={() => void handleSynchronizeNow()}>
        <RefreshCw size={19} aria-hidden="true" className={verdict.state === "SYNCING" ? styles.syncingIcon : undefined} />
        {verdict.state === "SYNCING" ? "Synchronisation…" : "Synchroniser maintenant"}
      </button>
      <p>{CLOUD_SYNC_VERDICT_LABELS[verdict.state]}</p>
      {verdict.verifiedAt && <p>Dernière synchronisation vérifiée : {new Date(verdict.verifiedAt).toLocaleString("fr-FR")}</p>}
      {verdict.bootstrapAt && <p>Dernier bootstrap : {new Date(verdict.bootstrapAt).toLocaleString("fr-FR")}</p>}
      {actionError && <p className={styles.syncError}>La tentative n’a pas abouti.</p>}
      <p>Fichiers des documents stockés uniquement sur cet appareil.</p>
      <Link href="/more/cloud-sync">Détails de synchronisation</Link>
    </section>
  </div><NavigationBar activeItem="Plus" /></main>;
}
