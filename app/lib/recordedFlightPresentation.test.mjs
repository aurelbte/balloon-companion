import assert from "node:assert/strict";
import test from "node:test";
import { getFlightReplayPath } from "./recordedFlightPresentation.ts";

test("construit l’URL de relecture avec l’identifiant encodé", () => {
  assert.equal(getFlightReplayPath("vol/essai 1"), "/flights/vol%2Fessai%201");
});
