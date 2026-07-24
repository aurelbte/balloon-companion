import assert from "node:assert/strict";
import test from "node:test";
import {
  AirspaceHttpError,
  AirspaceOfflineError,
  AirspaceTimeoutError,
  classifyAirspaceError,
  getAirspaceUiPresentation,
} from "./airspaceLoadState.ts";

const presentation = (overrides = {}) =>
  getAirspaceUiPresentation({
    explorationEnabled: true,
    coverageStatus: "UNAVAILABLE",
    failures: [],
    hasData: false,
    staleCacheUsed: false,
    ...overrides,
  });

test("classe un vrai mode hors ligne sans cache", () => {
  const failure = classifyAirspaceError(new TypeError("fetch failed"), false);
  assert.equal(failure.category, "OFFLINE");
  assert.deepEqual(presentation({ failures: [failure] }), {
    state: "OFFLINE",
    message: "Espaces aériens indisponibles hors ligne",
  });
});

test("ne présente jamais un timeout connecté comme hors ligne", () => {
  const failure = classifyAirspaceError(new AirspaceTimeoutError(), true);
  assert.equal(failure.category, "TIMEOUT");
  assert.equal(presentation({ failures: [failure] }).state, "ERROR");
});

test("classe une erreur HTTP avec son statut", () => {
  assert.deepEqual(
    classifyAirspaceError(new AirspaceHttpError(503), true),
    { category: "HTTP_ERROR", httpStatus: 503 },
  );
});

test("classe une réponse JSON invalide", () => {
  assert.equal(
    classifyAirspaceError(new SyntaxError("invalid JSON"), true).category,
    "PARSE_ERROR",
  );
});

test("distingue une réponse vide de l'échec de chargement", () => {
  assert.deepEqual(
    presentation({ coverageStatus: "COMPLETE" }),
    {
      state: "NO_DATA",
      message: "Aucun espace aérien disponible dans cette zone",
    },
  );
});

test("des données valides suppriment toute alerte", () => {
  assert.deepEqual(
    presentation({ coverageStatus: "COMPLETE", hasData: true }),
    { state: "READY", message: null },
  );
});

test("un cache utilisable reste affiché après un échec réseau", () => {
  assert.deepEqual(
    presentation({
      coverageStatus: "COMPLETE",
      failures: [classifyAirspaceError(new AirspaceOfflineError(), false)],
      hasData: true,
      staleCacheUsed: true,
    }),
    { state: "CACHE", message: "Données en cache" },
  );
});

test("une annulation de déplacement ne devient pas une erreur utilisateur", () => {
  const aborted = new Error("aborted");
  aborted.name = "AbortError";
  const failure = classifyAirspaceError(aborted, true);
  assert.equal(failure.category, "ABORTED");
  assert.deepEqual(presentation({ failures: [failure] }), {
    state: "LOADING",
    message: null,
  });
});
