import type { OfficialLoadActivationCandidate } from "./types.ts";
import { CAMERON_ISSUE_10_A18_REVISION, CAMERON_METHOD_A2_ID, cameronZ105Parameters } from "./cameronModels.ts";

/**
 * Deliberately empty. Entries may be added only after method, model parameters,
 * source traceability, targeted tests and real-aircraft limits are all confirmed.
 */
export const enabledOfficialLoadParameterCombinations = Object.freeze(
  [] as readonly OfficialLoadActivationCandidate[],
);

export const enabledPilotValidationLoadConfigurations = Object.freeze([
  {
    manufacturerMethodId: CAMERON_METHOD_A2_ID,
    modelParameterSetId: cameronZ105Parameters.id,
    manualRevision: CAMERON_ISSUE_10_A18_REVISION,
    status: "CANDIDATE_PILOT_VALIDATION",
  },
] as const);
