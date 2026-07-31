import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPreparationDraft,
  loadPreparationDraft,
  PREPARATION_DRAFT_STORAGE_KEY,
  savePreparationDraft,
} from "./preparationDraftStorage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("conserve un brouillon validé dans la session puis le supprime", () => {
  const sessionStorage = memoryStorage();
  globalThis.window = { sessionStorage };
  const draft = {
    storageVersion: 2,
    launchSite: { name: "LFQO", latitude: 50.686341, longitude: 3.079865 },
    departureTime: "2026-08-01T06:00:00.000Z",
    durationMinutes: 60,
    weatherModel: "arome_seamless",
    targetAltitudeAmslM: null,
    selectedAltitudes: ["ground", 300],
    balloonName: "F-HLFM",
    passengerWeightKg: 250,
    createdAt: 1,
    updatedAt: 2,
  };

  assert.equal(savePreparationDraft(draft), true);
  assert.deepEqual(loadPreparationDraft(), draft);
  assert.ok(sessionStorage.getItem(PREPARATION_DRAFT_STORAGE_KEY));
  clearPreparationDraft();
  assert.equal(loadPreparationDraft(), null);
  delete globalThis.window;
});

test("ignore un brouillon invalide", () => {
  const sessionStorage = memoryStorage();
  globalThis.window = { sessionStorage };
  sessionStorage.setItem(PREPARATION_DRAFT_STORAGE_KEY, "{\"bad\":true}");
  assert.equal(loadPreparationDraft(), null);
  delete globalThis.window;
});
