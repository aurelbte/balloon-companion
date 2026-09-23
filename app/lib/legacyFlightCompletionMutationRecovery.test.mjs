import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recoverLegacyFlightCompletionMutation } from "./legacyFlightCompletionMutationRecovery.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";

const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const legacy = (extra = {}) => ({ mutationId: "legacy", entityType: "flight-completion", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: "2026-09-23T10:00:00.000Z", attempts: 0, ...extra });
const other = { mutationId: "flight", entityType: "flight", entityId: "f1", operation: "UPSERT", baseRevision: 0, createdAt: "2026-09-23T10:00:01.000Z", attempts: 0 };

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

function fixture(mutations, issues = [], stored = storage()) {
  let rows = structuredClone(mutations), generation = 4, activeScope = scope;
  return {
    input: {
      storage: stored,
      scope,
      outbox: {
        getScope: () => scope,
        list: async () => structuredClone(rows),
        removeManyIfUnchanged: async (expected) => {
          if (expected.some(item => JSON.stringify(rows.find(row => row.mutationId === item.mutationId)) !== JSON.stringify(item))) return false;
          rows = rows.filter(row => !expected.some(item => item.mutationId === row.mutationId));
          return true;
        },
      },
      issues: { list: async () => structuredClone(issues) },
      getScope: () => activeScope,
      getGeneration: () => generation,
    },
    rows: () => rows,
    switchUser: () => { activeScope = "USER:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; generation += 1; },
  };
}

test("un ancien singleton flight-completion vide est retiré atomiquement sans toucher aux autres mutations", async () => {
  const context = fixture([legacy(), other]);
  assert.deepEqual(await recoverLegacyFlightCompletionMutation(context.input), { state: "REMOVED", removed: 1 });
  assert.deepEqual(context.rows(), [other]);
});

test("snapshot, intention C2 ou diagnostic rendent le nettoyage ambigu", async (t) => {
  const intentStorage = storage({
    [scopedBusinessStorageKey(scope, "balloon-companion-flight-completion-v1")]: JSON.stringify({
      __balloonPendingSync: [{ mutationId: "intent", entityType: "flight-completion", entityId: "singleton", operation: "UPSERT" }],
    }),
  });
  const cases = [
    ["snapshot", fixture([legacy({ payloadSnapshot: { serverEntityType: "unknown", serverEntityId: "singleton", payload: {} } })])],
    ["intention transportée", fixture([legacy({ durableIntentIds: ["intent"] })])],
    ["intention stockée", fixture([legacy()], [], intentStorage)],
    ["diagnostic", fixture([legacy()], [{ kind: "BLOCKED_ERROR", errorCode: "UNKNOWN", entityType: "flight-completion", entityId: "singleton", mutation: legacy() }])],
  ];
  for (const [name, context] of cases) await t.test(name, async () => {
    assert.deepEqual(await recoverLegacyFlightCompletionMutation(context.input), { state: "AMBIGUOUS", removed: 0 });
    assert.equal(context.rows().length, 1);
  });
});

test("un changement de scope avant le nettoyage conserve le marqueur", async () => {
  const context = fixture([legacy()]);
  context.switchUser();
  assert.deepEqual(await recoverLegacyFlightCompletionMutation(context.input), { state: "OBSOLETE", removed: 0 });
  assert.equal(context.rows().length, 1);
});

test("la récupération locale nettoie le legacy avant que le passage Cloud reprenne", () => {
  const source = readFileSync(new URL("./cloudSyncBrowser.ts", import.meta.url), "utf8");
  assert.match(source, /await recoverBrowserLocalSyncIntents[\s\S]*await recoverLegacyFlightCompletionMutation/);
});
