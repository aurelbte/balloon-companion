import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getRuntimeDataScope,
  guestBusinessStorageKey,
  readScopedBusinessValue,
  scopedBusinessStorageKey,
  scopedIndexedDbName,
  setRuntimeAuthSnapshot,
  setRuntimeGuestModeActive,
  writeScopedBusinessValue,
} from "./dataScopeRuntime.ts";

const user = (id) => ({ id, email: `${id}@example.com`, firstName: "", lastName: "" });
function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), snapshot: () => Object.fromEntries(values) };
}

test("GUEST utilise son stockage propre et laisse le legacy intact", () => {
  const local = storage({ journal: "legacy" });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(getRuntimeDataScope(), "GUEST");
  assert.equal(readScopedBusinessValue(local, "journal"), null);
  writeScopedBusinessValue(local, "journal", "guest-update");
  assert.equal(local.getItem("journal"), "legacy");
  assert.equal(local.getItem(guestBusinessStorageKey("journal")), "guest-update");

  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  assert.equal(readScopedBusinessValue(local, "journal"), null);
  assert.equal(local.getItem("journal"), "legacy");
});

test("SIGNED_OUT reste sans scope avant le choix explicite du mode invité", () => {
  const local = storage({ journal: "legacy-secret" });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(false);
  assert.equal(getRuntimeDataScope(), null);
  assert.equal(readScopedBusinessValue(local, "journal"), null);
  assert.equal(writeScopedBusinessValue(local, "journal", "interdit"), false);
  assert.equal(local.getItem("journal"), "legacy-secret");
});

test("USER A et USER B sont isolés sans fallback legacy", () => {
  const local = storage({ balloons: "legacy-balloons" });
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  writeScopedBusinessValue(local, "balloons", "A-balloons");
  assert.equal(readScopedBusinessValue(local, "balloons"), "A-balloons");

  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("B") });
  assert.equal(readScopedBusinessValue(local, "balloons"), null);
  writeScopedBusinessValue(local, "balloons", "B-balloons");

  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  assert.equal(readScopedBusinessValue(local, "balloons"), "A-balloons");
  assert.equal(local.getItem("balloons"), "legacy-balloons");
  assert.equal(local.getItem(scopedBusinessStorageKey("USER:B", "balloons")), "B-balloons");
});

test("OFFLINE_SESSION retrouve exactement le scope du même user", () => {
  const local = storage();
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  writeScopedBusinessValue(local, "profile", "A-profile");
  setRuntimeAuthSnapshot({ state: "OFFLINE_SESSION", user: user("A") });
  assert.equal(getRuntimeDataScope(), "USER:A");
  assert.equal(readScopedBusinessValue(local, "profile"), "A-profile");
});

test("les bases vols et documents changent avec le scope", () => {
  assert.equal(scopedIndexedDbName("GUEST", "balloon-companion-flights"), "balloon-companion-flights:guest");
  assert.notEqual(scopedIndexedDbName("USER:A", "balloon-companion-flights"), scopedIndexedDbName("USER:B", "balloon-companion-flights"));
});

test("les frontières métier utilisent le runtime scoped sans Supabase ni fallback", () => {
  const sources = ["../flightCompletionStorage.ts", "../balloonStorage.ts", "../pilotProfileStorage.ts", "../favoriteLaunchSites.ts", "../recordedFlightStorage.ts", "../balloonDocumentStorage.ts"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.match(sources, /readScopedBusinessValue/);
  assert.match(sources, /scopedIndexedDbName/);
  assert.doesNotMatch(sources, /supabase|USER.*email|fallback.*legacy/i);
});
