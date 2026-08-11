"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBalloonAuth } from "../contexts/AuthContext";
import {
  AUTH_CONTINUE_ROUTE,
  AUTH_SIGN_IN_ROUTE,
  AUTH_SIGN_UP_ROUTE,
  continueWithoutAccount,
} from "../lib/auth/entry.ts";
import styles from "./Auth.module.css";

export default function AuthEntryPage() {
  const router = useRouter();
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

  return (
    <main className={styles.screen}>
      <section className={styles.entry} aria-labelledby="auth-title">
        <div className={styles.brand} aria-hidden="true">BC</div>
        <header>
          <p className={styles.eyebrow}>Balloon Companion</p>
          <h1 id="auth-title">Balloon Companion</h1>
          <p className={styles.tagline}>Construit par un pilote, pour des pilotes.</p>
        </header>
        {auth.state === "UNKNOWN" ? (
          <p className={styles.authLoading} aria-live="polite">Vérification de la session…</p>
        ) : auth.state === "SIGNED_OUT" ? (
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href={AUTH_SIGN_UP_ROUTE}>Créer un compte</Link>
            <Link className={styles.secondaryAction} href={AUTH_SIGN_IN_ROUTE}>Se connecter</Link>
            <button
              className={styles.continueAction}
              type="button"
              onClick={() => {
                continueWithoutAccount();
                router.replace(AUTH_CONTINUE_ROUTE);
              }}
            >
              Continuer sans compte
            </button>
          </div>
        ) : (
          <div className={styles.signedInAccount}>
            {displayName && <strong>{displayName}</strong>}
            <span>{auth.user?.email}</span>
            <em>{auth.state === "OFFLINE_SESSION" ? "Hors ligne" : "Connecté"}</em>
            <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
              {signingOut ? "Déconnexion…" : "Déconnexion"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
