"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { AUTH_SIGN_IN_ROUTE } from "../../lib/auth/entry.ts";
import styles from "./Confirmed.module.css";

type ConfirmationState = "CHECKING" | "SIGNED_IN" | "SIGNED_OUT";

export default function ConfirmedPage() {
  const { confirmEmail } = useBalloonAuth();
  const router = useRouter();
  const [confirmationState, setConfirmationState] = useState<ConfirmationState>("CHECKING");

  useEffect(() => {
    let active = true;
    let redirectTimer: number | undefined;
    const code = new URLSearchParams(window.location.search).get("code") ?? undefined;
    void confirmEmail(code).then((signedIn) => {
      if (!active) return;
      setConfirmationState(signedIn ? "SIGNED_IN" : "SIGNED_OUT");
      if (signedIn) redirectTimer = window.setTimeout(() => router.replace("/"), 650);
    });
    return () => {
      active = false;
      if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
    };
  }, [confirmEmail, router]);

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-live="polite">
        <p className={styles.eyebrow}>Balloon Companion</p>
        {confirmationState === "CHECKING" ? (
          <><h1>Confirmation en cours…</h1><p className={styles.copy}>Nous restaurons votre session.</p></>
        ) : (
          <>
            <h1>Adresse email confirmée.</h1>
            {confirmationState === "SIGNED_IN" ? (
              <p className={styles.copy}>Ouverture de Balloon Companion…</p>
            ) : (
              <><p className={styles.copy}>Connectez-vous pour continuer.</p><Link className={styles.primaryAction} href={AUTH_SIGN_IN_ROUTE}>Se connecter</Link></>
            )}
          </>
        )}
      </section>
    </main>
  );
}
