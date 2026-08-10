"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AUTH_CONTINUE_ROUTE,
  AUTH_SIGN_IN_ROUTE,
  AUTH_SIGN_UP_ROUTE,
  continueWithoutAccount,
} from "../lib/auth/entry.ts";
import styles from "./Auth.module.css";

export default function AuthEntryPage() {
  const router = useRouter();
  return (
    <main className={styles.screen}>
      <section className={styles.entry} aria-labelledby="auth-title">
        <div className={styles.brand} aria-hidden="true">BC</div>
        <header>
          <p className={styles.eyebrow}>Balloon Companion</p>
          <h1 id="auth-title">Balloon Companion</h1>
          <p className={styles.tagline}>Construit par un pilote, pour des pilotes.</p>
        </header>
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
      </section>
    </main>
  );
}

