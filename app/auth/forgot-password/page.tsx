"use client";

import Link from "next/link";
import { useState } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { AUTH_SIGN_IN_ROUTE } from "../../lib/auth/entry.ts";
import { normalizeRecoveryEmail } from "../../lib/auth/passwordRecoveryForm.ts";
import styles from "../sign-in/SignIn.module.css";

const GENERIC_SUCCESS = "Si un compte existe pour cette adresse, un lien de réinitialisation vient de vous être envoyé.";

export default function ForgotPasswordPage() {
  const auth = useBalloonAuth();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const normalizedEmail = normalizeRecoveryEmail(email);

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="forgot-password-title">
        <Link className={styles.backLink} href={AUTH_SIGN_IN_ROUTE}>← Retour à la connexion</Link>
        <p className={styles.eyebrow}>Balloon Companion</p>
        <h1 id="forgot-password-title">Mot de passe oublié</h1>
        <p className={styles.copy}>Indiquez l’adresse e-mail associée à votre compte.</p>
        <form className={styles.form} noValidate onSubmit={async (event) => {
          event.preventDefault();
          setTouched(true);
          if (!normalizedEmail) return;
          setSubmitting(true);
          try { await auth.requestPasswordReset(normalizedEmail); } catch { /* Réponse volontairement identique. */ }
          setSent(true);
          setSubmitting(false);
        }}>
          <label className={styles.field}>
            <span>Adresse e-mail</span>
            <input name="email" type="email" inputMode="email" autoComplete="email" required value={email}
              aria-invalid={touched && !normalizedEmail}
              aria-describedby={touched && !normalizedEmail ? "recovery-email-error" : undefined}
              onBlur={() => setTouched(true)}
              onChange={(event) => { setEmail(event.target.value); setSent(false); }} />
            <small id="recovery-email-error" className={styles.error}>{touched && !normalizedEmail ? "E-mail invalide." : "\u00a0"}</small>
          </label>
          <button className={styles.submit} type="submit" disabled={!normalizedEmail || submitting}>{submitting ? "Envoi…" : "Envoyer le lien"}</button>
          {sent && <p className={styles.success} role="status">{GENERIC_SUCCESS}</p>}
        </form>
        <Link className={styles.signUpLink} href={AUTH_SIGN_IN_ROUTE}>Retour à la connexion</Link>
      </section>
    </main>
  );
}
