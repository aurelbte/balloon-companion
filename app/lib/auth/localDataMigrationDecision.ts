import type { KeyValueStorage } from "./deviceIdentity.ts";

export type LocalDataMigrationDecision = "MIGRATION_APPROVED" | "MIGRATION_DEFERRED";

export type StoredLocalDataMigrationDecision = Readonly<{
  userId: string;
  deviceId: string;
  decision: LocalDataMigrationDecision;
  decidedAt: string;
}>;

export const LOCAL_DATA_MIGRATION_DECISIONS_KEY = "balloon-companion-auth-local-data-decisions-v1";

function decisionId(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

function readDecisions(storage: KeyValueStorage): Record<string, StoredLocalDataMigrationDecision> {
  try {
    const value: unknown = JSON.parse(storage.getItem(LOCAL_DATA_MIGRATION_DECISIONS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, StoredLocalDataMigrationDecision>
      : {};
  } catch {
    return {};
  }
}

export function getLocalDataMigrationDecision(
  storage: KeyValueStorage,
  userId: string,
  deviceId: string,
): StoredLocalDataMigrationDecision | null {
  const decision = readDecisions(storage)[decisionId(userId, deviceId)];
  return decision?.userId === userId && decision.deviceId === deviceId &&
    (decision.decision === "MIGRATION_APPROVED" || decision.decision === "MIGRATION_DEFERRED")
    ? decision
    : null;
}

export function saveLocalDataMigrationDecision(
  storage: KeyValueStorage,
  input: Readonly<{ userId: string; deviceId: string; decision: LocalDataMigrationDecision; decidedAt?: string }>,
): StoredLocalDataMigrationDecision {
  const stored = {
    userId: input.userId,
    deviceId: input.deviceId,
    decision: input.decision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  } satisfies StoredLocalDataMigrationDecision;
  storage.setItem(LOCAL_DATA_MIGRATION_DECISIONS_KEY, JSON.stringify({
    ...readDecisions(storage),
    [decisionId(input.userId, input.deviceId)]: stored,
  }));
  return stored;
}
