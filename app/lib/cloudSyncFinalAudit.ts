export type FinalAuditMutationClassification = Readonly<{
  entityType: string;
  entityId: string;
  attempts: number;
  conflict: boolean;
  orphan: boolean;
  testResidual: boolean;
  localOnly: boolean;
}>;

export function isLegacyLocalOnlyMutation(input: Readonly<{ entityType: string; entityId: string }>): boolean {
  return input.entityType === "flight-completion" && input.entityId === "singleton";
}

export function classifyFinalAuditMutations(
  mutations: readonly FinalAuditMutationClassification[],
  hasOtherAttention = false,
) {
  const localOnlyMutations = mutations.filter(({ localOnly }) => localOnly);
  const cloudMutations = mutations.filter(({ localOnly }) => !localOnly);
  const conflicts = cloudMutations.filter(({ conflict }) => conflict);
  const attemptedMutations = cloudMutations.filter(({ attempts }) => attempts > 0);
  const orphanMutations = cloudMutations.filter(({ orphan }) => orphan);
  const testResiduals = cloudMutations.filter(({ testResidual }) => testResidual);
  const overall = conflicts.length || orphanMutations.length ? "BLOCKED"
    : cloudMutations.length || attemptedMutations.length || testResiduals.length || hasOtherAttention ? "ATTENTION"
      : "CLEAN";
  return { localOnlyMutations, conflicts, attemptedMutations, orphanMutations, testResiduals, overall } as const;
}
