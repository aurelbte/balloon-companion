const pending = new Map<string, Promise<void>>();

export function requestCloudSyncPostCleanupRecheck(input: Readonly<{
  scope: `USER:${string}`;
  generation: number;
  getScope(): string | null;
  getGeneration(): number;
  synchronize(): Promise<unknown>;
}>): Promise<void> {
  const key = `${input.scope}\u0000${input.generation}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = Promise.resolve().then(async () => {
    if (input.getScope() !== input.scope || input.getGeneration() !== input.generation) return;
    await input.synchronize();
  }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
  pending.set(key, operation);
  return operation;
}
