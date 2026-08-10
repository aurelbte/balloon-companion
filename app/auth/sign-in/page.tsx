"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { AUTH_ENTRY_ROUTE, AUTH_SIGN_UP_ROUTE } from "../../lib/auth/entry.ts";
import { validateSignInDraft } from "../../lib/auth/signInForm.ts";
import styles from "./SignIn.module.css";

export default function SignInPage() {
  const auth = useBalloonAuth();
  const router = useRouter();
  const [draft, setDraft] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const validation = validateSignInDraft(draft);
  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="sign-in-title">
        <Link className={styles.backLink} href={AUTH_ENTRY_ROUTE}>← Retour</Link>
        <p className={styles.eyebrow}>Balloon Companion</p>
        <h1 id="sign-in-title">Se connecter</h1>
        <form
          className={styles.form}
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setTouched({ email: true, password: true });
            if (!validation.valid) return;
            setSubmitting(true);
            setSubmitError(null);
            try {
              await auth.signIn(validation.value);
              router.replace("/more");
            } catch {
              setSubmitError("E-mail ou mot de passe incorrect.");
              setSubmitting(false);
            }
          }}
        >
          <label className={styles.field}>
            <span>Adresse e-mail</span>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={draft.email}
              aria-invalid={touched.email && Boolean(validation.errors.email)}
              aria-describedby={touched.email && validation.errors.email ? "email-error" : undefined}
              onBlur={() => setTouched((current) => ({ ...current, email: true }))}
              onChange={(event) => { setDraft((current) => ({ ...current, email: event.target.value })); setPlaceholder(null); setSubmitError(null); }}
            />
            <small id="email-error" className={styles.error}>{touched.email ? validation.errors.email ?? "\u00a0" : "\u00a0"}</small>
          </label>
          <label className={styles.field}>
            <span>Mot de passe</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={draft.password}
              aria-invalid={touched.password && Boolean(validation.errors.password)}
              aria-describedby={touched.password && validation.errors.password ? "password-error" : undefined}
              onBlur={() => setTouched((current) => ({ ...current, password: true }))}
              onChange={(event) => { setDraft((current) => ({ ...current, password: event.target.value })); setPlaceholder(null); setSubmitError(null); }}
            />
            <small id="password-error" className={styles.error}>{touched.password ? validation.errors.password ?? "\u00a0" : "\u00a0"}</small>
          </label>
          <button
            className={styles.forgot}
            type="button"
            onClick={() => setPlaceholder("La récupération du mot de passe sera disponible avec le futur service d’authentification.")}
          >
            Mot de passe oublié
          </button>
          <button className={styles.submit} type="submit" disabled={!validation.valid || submitting}>{submitting ? "Connexion…" : "Se connecter"}</button>
          {placeholder && <p className={styles.placeholder} role="status">{placeholder}</p>}
          {submitError && <p className={styles.error} role="alert">{submitError}</p>}
        </form>
        <Link className={styles.signUpLink} href={AUTH_SIGN_UP_ROUTE}>Créer un compte</Link>
      </section>
    </main>
  );
}
