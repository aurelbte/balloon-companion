"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import NavigationBar from "../components/NavigationBar";
import { useBalloonAuth } from "../contexts/AuthContext";
import { AUTH_SIGN_IN_ROUTE, AUTH_SIGN_UP_ROUTE } from "../lib/auth/entry";
import styles from "./More.module.css";

export default function MorePage() {
  const auth = useBalloonAuth();
  const [signingOut, setSigningOut] = useState(false);
  const displayName = [auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(" ");

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
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
    <Link href="/more/profile/balloons" className={styles.card}><div><h2>Mes ballons</h2><p>Matériel utilisé dans Balloon Companion</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/cloud-sync" className={styles.card}><div><h2>Synchronisation Cloud</h2><p>État, erreurs et conflits à résoudre</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/settings" className={styles.card}><div><h2>Réglages</h2><p>Comportement de l’application</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
  </div><NavigationBar activeItem="Plus" /></main>;
}
