import assert from "node:assert/strict";
import test from "node:test";
import { loadFlightSession, saveFlightSession } from "./flightSessionStorage.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

const user = { id: "flight-user", email: "pilot@example.com", firstName: "", lastName: "" };
const session = { status: "recording", startTime: 1_000, points: [], metrics: { altitude: null, verticalSpeed: null, groundSpeed: null, heading: null, durationSeconds: 12, distanceKm: 0.1, lastUpdated: 2_000 } };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("une session de vol USER n'est jamais restaurée chez GUEST", () => {
  globalThis.localStorage = storage();
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  assert.equal(saveFlightSession(session), true);
  const savedAt = loadFlightSession()?.savedAt;

  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(loadFlightSession(), null);
  assert.equal(saveFlightSession({ ...session, startTime: 3_000 }), true);
  assert.equal(loadFlightSession()?.startTime, 3_000);

  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user });
  assert.equal(loadFlightSession()?.startTime, 1_000);
  assert.equal(loadFlightSession()?.savedAt, savedAt);
  delete globalThis.localStorage;
});
