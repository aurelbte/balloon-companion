"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext.tsx";
import { AUTH_ENTRY_ROUTE, AUTH_SIGN_IN_ROUTE } from "../../lib/auth/entry.ts";
import { type SignUpDraft, type SignUpField, validateSignUpDraft } from "../../lib/auth/signUpForm.ts";
import styles from "./SignUp.module.css";

const initialDraft: SignUpDraft = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  passwordConfirmation: "",
};

export default function SignUpPage() {
  const auth = useBalloonAuth();
  const [draft, setDraft] = useState(initialDraft);
  const [touched, setTouched] = useState<Partial<Record<SignUpField, boolean>>>({});
  const [placeholderSuccess, setPlaceholderSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const validation = validateSignUpDraft(draft);
  const update = (field: SignUpField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setPlaceholderSuccess(null);
    setSubmitError(null);
  };
  const field = (name: SignUpField, label: string, options: Readonly<{ type?: string; autoComplete?: string; inputMode?: "email" }> = {}) => {
    const error = touched[name] ? validation.errors[name] : undefined;
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <input
          name={name}
          type={options.type ?? "text"}
          autoComplete={options.autoComplete}
          inputMode={options.inputMode}
          value={draft[name]}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          onBlur={() => setTouched((current) => ({ ...current, [name]: true }))}
          onChange={(event) => update(name, event.target.value)}
        />
        <small id={`${name}-error`} className={styles.error}>{error ?? "\u00a0"}</small>
      </label>
    );
  };
  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="sign-up-title">
        <Link className={styles.backLink} href={AUTH_ENTRY_ROUTE}>← Retour</Link>
        <Image
          className={styles.logo}
          src="/branding/balloon-companion-logo-account.png"
          alt="Balloon Companion"
          width={1842}
          height={854}
          priority
        />
        <h1 id="sign-up-title">Créer un compte</h1>
        <form
          className={styles.form}
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setTouched({ firstName: true, lastName: true, email: true, password: true, passwordConfirmation: true });
            if (!validation.valid) return;
            setSubmitting(true);
            setSubmitError(null);
            try {
              await auth.signUp(validation.value);
              setDraft((current) => ({ ...current, firstName: validation.value.firstName, lastName: validation.value.lastName, email: validation.value.email }));
              setPlaceholderSuccess("Vérifiez votre boîte mail afin d'activer votre compte.");
            } catch (error) {
              if (error instanceof Error && "code" in error && "status" in error) {
                setSubmitError(`message: ${error.message} · code: ${String(error.code ?? "null")} · status: ${String(error.status ?? "null")}`);
              } else {
                setSubmitError("Création impossible. Vérifiez vos informations.");
              }
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className={styles.nameGrid}>
            {field("firstName", "Prénom", { autoComplete: "given-name" })}
            {field("lastName", "Nom", { autoComplete: "family-name" })}
          </div>
          {field("email", "Adresse e-mail", { type: "email", autoComplete: "email", inputMode: "email" })}
          {field("password", "Mot de passe", { type: "password", autoComplete: "new-password" })}
          {field("passwordConfirmation", "Confirmation du mot de passe", { type: "password", autoComplete: "new-password" })}
          <button className={styles.submit} type="submit" disabled={!validation.valid || submitting}>{submitting ? "Création…" : "Créer mon compte"}</button>
          {placeholderSuccess && <p className={styles.success} role="status">{placeholderSuccess}</p>}
          {submitError && <p className={styles.error} role="alert">{submitError}</p>}
        </form>
        <Link className={styles.signInLink} href={AUTH_SIGN_IN_ROUTE}>J’ai déjà un compte</Link>
      </section>
    </main>
  );
}
