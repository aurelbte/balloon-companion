import type { AuthSnapshot } from "./types.ts";

export const AUTH_ENTRY_ROUTE = "/auth";
export const AUTH_SIGN_UP_ROUTE = "/auth/sign-up";
export const AUTH_SIGN_IN_ROUTE = "/auth/sign-in";
export const AUTH_CONTINUE_ROUTE = "/more";

/** Continuer sans compte ne crée aucune session et ne persiste rien. */
export function continueWithoutAccount(): AuthSnapshot {
  return { state: "SIGNED_OUT", user: null };
}

