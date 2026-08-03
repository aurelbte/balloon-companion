import type { OfficialLoadActivationCandidate } from "./types.ts";

/**
 * Deliberately empty. Entries may be added only after method, model parameters,
 * source traceability, targeted tests and real-aircraft limits are all confirmed.
 */
export const enabledOfficialLoadParameterCombinations = Object.freeze(
  [] as readonly OfficialLoadActivationCandidate[],
);
