export type SignInDraft = Readonly<{
  email: string;
  password: string;
}>;

export type SignInErrors = Partial<Record<keyof SignInDraft, string>>;

export type SignInValidation = Readonly<{
  valid: boolean;
  errors: SignInErrors;
  value: SignInDraft;
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignInDraft(draft: SignInDraft): SignInValidation {
  const email = draft.email.trim().toLocaleLowerCase("fr-FR");
  const errors: SignInErrors = {};
  if (!email) errors.email = "E-mail requis.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "E-mail invalide.";
  if (!draft.password) errors.password = "Mot de passe requis.";
  else if (draft.password.length < 8) errors.password = "8 caractères minimum.";
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { email, password: draft.password },
  };
}

