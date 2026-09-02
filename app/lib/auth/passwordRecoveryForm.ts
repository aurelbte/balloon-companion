export type PasswordRecoveryDraft = Readonly<{
  password: string;
  passwordConfirmation: string;
}>;

export function normalizeRecoveryEmail(value: string): string | null {
  const email = value.trim().toLocaleLowerCase("fr-FR");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function validatePasswordRecoveryDraft(draft: PasswordRecoveryDraft): Readonly<{
  valid: boolean;
  passwordError?: string;
  confirmationError?: string;
}> {
  const passwordError = !draft.password
    ? "Mot de passe requis."
    : draft.password.length < 8
      ? "8 caractères minimum."
      : undefined;
  const confirmationError = !draft.passwordConfirmation
    ? "Confirmation requise."
    : draft.passwordConfirmation !== draft.password
      ? "Les mots de passe diffèrent."
      : undefined;
  return { valid: !passwordError && !confirmationError, passwordError, confirmationError };
}
