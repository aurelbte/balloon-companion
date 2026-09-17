import type { KeyValueStorage } from "./deviceIdentity.ts";

export type LocalDataMigrationDecision = "MIGRATION_APPROVED" | "MIGRATION_DEFERRED";

export type StoredLocalDataMigrationDecision = Readonly<{
  userId: string;
  deviceId: string;
  decision: LocalDataMigrationDecision;
  decidedAt: string;
  manifestId?: string;
}>;

export const LOCAL_DATA_MIGRATION_DECISIONS_KEY = "balloon-companion-auth-local-data-decisions-v1";

function decisionId(userId: string, deviceId: string, manifestId?: string): string {
  return `${userId}:${deviceId}${manifestId ? `:${manifestId}` : ""}`;
}

function readDecisions(storage: KeyValueStorage, strict = false): Record<string, StoredLocalDataMigrationDecision> {
  try {
    const value: unknown = JSON.parse(storage.getItem(LOCAL_DATA_MIGRATION_DECISIONS_KEY) ?? "{}");
    if (strict && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("INVALID_IMPORT_DECISION");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, StoredLocalDataMigrationDecision>
      : {};
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}

export function getLocalDataMigrationDecision(
  storage: KeyValueStorage,
  userId: string,
  deviceId: string,
  manifestId?: string,
): StoredLocalDataMigrationDecision | null {
  const decisions = readDecisions(storage, manifestId !== undefined);
  const decision = decisions[decisionId(userId, deviceId, manifestId)] ?? decisions[decisionId(userId, deviceId)];
  if (manifestId && decision && (typeof decision.userId !== "string" || typeof decision.deviceId !== "string" || !["MIGRATION_APPROVED", "MIGRATION_DEFERRED"].includes(decision.decision) || (decision.manifestId !== undefined && typeof decision.manifestId !== "string"))) throw new Error("INVALID_IMPORT_DECISION");
  return decision?.userId === userId && decision.deviceId === deviceId && (!manifestId || !decision.manifestId || decision.manifestId === manifestId) &&
    (decision.decision === "MIGRATION_APPROVED" || decision.decision === "MIGRATION_DEFERRED")
    ? decision
    : null;
}

export function saveLocalDataMigrationDecision(
  storage: KeyValueStorage,
  input: Readonly<{ userId: string; deviceId: string; decision: LocalDataMigrationDecision; decidedAt?: string; manifestId?: string }>,
): StoredLocalDataMigrationDecision {
  const stored = {
    userId: input.userId,
    deviceId: input.deviceId,
    decision: input.decision,
    ...(input.manifestId ? { manifestId: input.manifestId } : {}),
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  } satisfies StoredLocalDataMigrationDecision;
  storage.setItem(LOCAL_DATA_MIGRATION_DECISIONS_KEY, JSON.stringify({
    ...readDecisions(storage),
    [decisionId(input.userId, input.deviceId, input.manifestId)]: stored,
  }));
  return stored;
}
