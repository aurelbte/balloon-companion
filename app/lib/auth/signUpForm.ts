export type SignUpDraft = Readonly<{
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}>;

export type SignUpField = keyof SignUpDraft;
export type SignUpErrors = Partial<Record<SignUpField, string>>;

export type ValidatedSignUpDraft = Readonly<{
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}>;

export type SignUpValidation = Readonly<{
  valid: boolean;
  errors: SignUpErrors;
  value: ValidatedSignUpDraft;
}>;

const NAME_MAX_LENGTH = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignUpDraft(draft: SignUpDraft): SignUpValidation {
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const email = draft.email.trim().toLocaleLowerCase("fr-FR");
  const errors: SignUpErrors = {};

  if (!firstName) errors.firstName = "Prénom requis.";
  else if (firstName.length > NAME_MAX_LENGTH) errors.firstName = "Prénom trop long.";
  if (!lastName) errors.lastName = "Nom requis.";
  else if (lastName.length > NAME_MAX_LENGTH) errors.lastName = "Nom trop long.";
  if (!email) errors.email = "E-mail requis.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "E-mail invalide.";
  if (!draft.password) errors.password = "Mot de passe requis.";
  else if (draft.password.length < 8) errors.password = "8 caractères minimum.";
  if (!draft.passwordConfirmation) errors.passwordConfirmation = "Confirmation requise.";
  else if (draft.passwordConfirmation !== draft.password) errors.passwordConfirmation = "Les mots de passe diffèrent.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { firstName, lastName, email, password: draft.password },
  };
}

