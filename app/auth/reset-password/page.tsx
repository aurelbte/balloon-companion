"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { AUTH_SIGN_IN_ROUTE } from "../../lib/auth/entry.ts";
import { validatePasswordRecoveryDraft } from "../../lib/auth/passwordRecoveryForm.ts";
import styles from "../sign-in/SignIn.module.css";

type RecoveryState = "CHECKING" | "READY" | "INVALID" | "SUCCESS";

export default function ResetPasswordPage() {
  const auth = useBalloonAuth();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<RecoveryState>("CHECKING");
  const [draft, setDraft] = useState({ password: "", passwordConfirmation: "" });
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validation = validatePasswordRecoveryDraft(draft);

  useEffect(() => {
    const callbackCode = new URLSearchParams(window.location.search).get("code");
    setCode(callbackCode);
    setState(callbackCode ? "READY" : "INVALID");
  }, []);

  if (state === "CHECKING") return <main className={styles.screen}><section className={styles.panel}><p className={styles.eyebrow}>Balloon Companion</p><h1>Vérification du lien…</h1></section></main>;
  if (state === "INVALID") return <main className={styles.screen}><section className={styles.panel}><p className={styles.eyebrow}>Balloon Companion</p><h1>Lien invalide ou expiré</h1><p className={styles.copy}>Demandez un nouveau lien de réinitialisation. Une session déjà ouverte doit d’abord être fermée.</p><Link className={styles.signUpLink} href="/auth/forgot-password">Demander un nouveau lien</Link></section></main>;
  if (state === "SUCCESS") return <main className={styles.screen}><section className={styles.panel}><p className={styles.eyebrow}>Balloon Companion</p><h1>Mot de passe modifié</h1><p className={styles.success}>Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p><Link className={styles.signUpLink} href={AUTH_SIGN_IN_ROUTE}>Se connecter</Link></section></main>;

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="reset-password-title">
        <p className={styles.eyebrow}>Balloon Companion</p>
        <h1 id="reset-password-title">Nouveau mot de passe</h1>
        <form className={styles.form} noValidate onSubmit={async (event) => {
          event.preventDefault(); setTouched(true);
          if (!validation.valid) return;
          setSubmitting(true);
          try {
            if (!code) { setState("INVALID"); return; }
            window.history.replaceState({}, "", window.location.pathname);
            await auth.recoverPassword(code, draft.password);
            setState("SUCCESS");
            window.setTimeout(() => router.replace(AUTH_SIGN_IN_ROUTE), 900);
          } catch {
            setState("INVALID");
          }
        }}>
          <label className={styles.field}><span>Nouveau mot de passe</span><input name="password" type="password" autoComplete="new-password" required value={draft.password} aria-invalid={touched && Boolean(validation.passwordError)} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} /><small className={styles.error}>{touched ? validation.passwordError ?? "\u00a0" : "\u00a0"}</small></label>
          <label className={styles.field}><span>Confirmer le mot de passe</span><input name="passwordConfirmation" type="password" autoComplete="new-password" required value={draft.passwordConfirmation} aria-invalid={touched && Boolean(validation.confirmationError)} onChange={(event) => setDraft((current) => ({ ...current, passwordConfirmation: event.target.value }))} /><small className={styles.error}>{touched ? validation.confirmationError ?? "\u00a0" : "\u00a0"}</small></label>
          <button className={styles.submit} type="submit" disabled={!validation.valid || submitting}>{submitting ? "Modification…" : "Modifier le mot de passe"}</button>
        </form>
      </section>
    </main>
  );
}
