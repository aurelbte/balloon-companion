import test from "node:test";
import assert from "node:assert/strict";
import { BALLOON_CATALOG, catalogModels, catalogVolume } from "./balloonCatalog.ts";
import {
  balloonDisplayName,
  balloonSnapshot,
  calculateBalloonWeight,
  createBalloon,
  officialFieldsForBalloon,
  REGISTERED_BALLOONS,
  resolveBalloonForFlight,
  updateBalloon,
} from "./balloons.ts";
import { balloonMassFormDraft, canSubmitHydratedBalloonForm } from "./balloonFormHydration.ts";
import {
  addBalloonToRegistry,
  BALLOON_REGISTRY_VERSION,
  createDefaultBalloonRegistry,
  getActiveBalloon,
  migrateBalloonRegistry,
  removeBalloonFromRegistry,
  setActiveBalloonInRegistry,
  updateBalloonInRegistry,
} from "./balloonStorage.ts";

const weights = {
  envelopeKg: 285,
  burnerKg: 72,
  basketKg: 220,
  fullCylinders: [
    { id: "c1", label: "Cylindre 1", fullWeightKg: 64 },
    { id: "c2", label: "Cylindre 2", fullWeightKg: 64 },
    { id: "c3", label: "Cylindre 3", fullWeightKg: 64 },
    { id: "c4", label: "Cylindre 4", fullWeightKg: 64 },
  ],
};
const input = {
  registration: " fhlfm ",
  manufacturer: " Cameron ",
  model: " Z105 ",
  category: "Libre à air chaud",
  volumeM3: 2_973,
  weights,
};

test("le catalogue central ne contient que les modèles documentés", () => {
  assert.equal(BALLOON_CATALOG.length, 3);
  assert.deepEqual(catalogModels("Cameron").map(({ model }) => model), ["Z90", "Z105", "Z120", "Z133", "Z150", "Z160", "Z180", "Z210", "Z250", "Z300", "Z350", "Z425"]);
  assert.equal(catalogVolume("Cameron", "Z90"), 2_549);
  assert.equal(catalogVolume("Cameron", "Z105"), 2_973);
  assert.equal(catalogVolume("Cameron", "Z120"), 3_398);
  assert.equal(catalogVolume("Cameron", "Z133"), 3_766);
  assert.equal(catalogVolume("Cameron", "Z150"), 4_247);
  assert.equal(catalogVolume("Cameron", "Z160"), 4_531);
  assert.equal(catalogVolume("Cameron", "Z180"), 5_097);
  assert.equal(catalogVolume("Cameron", "Z210"), 5_947);
  assert.equal(catalogVolume("Cameron", "Z250"), 7_079);
  assert.equal(catalogVolume("Cameron", "Z300"), 8_495);
  assert.equal(catalogVolume("Cameron", "Z350"), 9_911);
  assert.equal(catalogVolume("Cameron", "Z425"), 12_035);
  assert.equal(catalogVolume("Ultramagic", "S105"), 2_950);
  assert.equal(catalogVolume("Ultramagic", "N415"), 11_750);
  assert.equal(catalogVolume("Kubíček", "BB26M"), 2_600);
  assert.equal(catalogVolume("Kubíček", "BB100Z"), 10_000);
  assert.equal(catalogVolume("Autre", "Libre"), null);
  assert.equal(BALLOON_CATALOG.every(({ models }) => models.every((model) => !("weights" in model))), true);
});

test("les ballons de démonstration restent incomplets sans masses inventées", () => {
  assert.equal(REGISTERED_BALLOONS.length, 4);
  assert.equal(balloonDisplayName(REGISTERED_BALLOONS[0]), "F-HLFM • Cameron Z105");
  assert.equal(REGISTERED_BALLOONS[0].volumeM3, 2_973);
  assert.equal(REGISTERED_BALLOONS[0].applicableMtowKg, 952);
  assert.equal(REGISTERED_BALLOONS[0].configurationLimitsConfirmed, false);
  assert.deepEqual(REGISTERED_BALLOONS[0].weights, { fullCylinders: [] });
  assert.equal(calculateBalloonWeight(REGISTERED_BALLOONS[0].weights), null);
});

test("création, normalisation et conservation des saisies libres", () => {
  const balloon = createBalloon(input);
  assert.equal(balloon.registration, "F-HLFM");
  assert.equal(balloon.manufacturer, "Cameron");
  assert.equal(balloon.model, "Z105");
  assert.equal(balloon.color, undefined);
  const custom = createBalloon({ ...input, registration: "f-abcd", manufacturer: "Autre", model: "Prototype", volumeM3: 3_111 });
  assert.equal(custom.registration, "F-ABCD");
  assert.equal(custom.model, "Prototype");
  assert.equal(custom.volumeM3, 3_111);
  const configured = createBalloon({ ...input, applicableMtowKg: 952 });
  assert.equal(configured.applicableMtowKg, 952);
  assert.equal(configured.configurationLimitsConfirmed, false);
});

test("le poids total est toujours dérivé des composants", () => {
  assert.equal(calculateBalloonWeight(weights), 833);
  assert.equal(calculateBalloonWeight({ ...weights, envelopeKg: 285.5 }), 833.5);
  assert.equal(calculateBalloonWeight({ ...weights, fullCylinders: weights.fullCylinders.slice(0, 3) }), 769);
  assert.equal(calculateBalloonWeight({ ...weights, burnerKg: undefined }), null);
  assert.equal(calculateBalloonWeight({ ...weights, fullCylinders: [{ id: "vide", fullWeightKg: 0 }] }), null);
  assert.equal("totalWeightKg" in createBalloon(input), false);
});

test("le premier ballon devient actif et le second ne remplace pas l’actif", () => {
  const empty = { version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null };
  const first = addBalloonToRegistry(empty, input);
  assert.equal(first.registry.activeBalloonId, first.balloon.id);
  const second = addBalloonToRegistry(first.registry, { ...input, registration: "F-EFGH" });
  assert.equal(second.registry.activeBalloonId, first.balloon.id);
});

test("le registre conserve ses usages existants", () => {
  const registry = createDefaultBalloonRegistry();
  assert.equal(setActiveBalloonInRegistry(registry, "F-HOBA").activeBalloonId, "F-HOBA");
  assert.equal(getActiveBalloon(setActiveBalloonInRegistry(registry, "F-HMIG"))?.registration, "F-HMIG");
  const updated = updateBalloonInRegistry(registry, "F-HLFM", { ...input, registration: "F-NEWW" });
  assert.equal(updated.balloons[0].id, "F-HLFM");
  assert.equal(updated.balloons[0].registration, "F-NEWW");
  assert.equal(removeBalloonFromRegistry(registry, "F-HOBA").activeBalloonId, "F-HLFM");
  assert.equal(removeBalloonFromRegistry(registry, "F-HLFM").activeBalloonId, null);
});

test("les snapshots et données officielles restent stables", () => {
  const original = createBalloon(input);
  const snapshot = balloonSnapshot(original);
  const modified = createBalloon({ ...input, model: "Z105 modifié" }, original.id);
  assert.equal(snapshot.model, "Z105");
  assert.equal(modified.model, "Z105 modifié");
  assert.deepEqual(officialFieldsForBalloon(REGISTERED_BALLOONS[1]), {
    registration: "F-HOBA",
    balloonModel: "Cameron Z350",
    balloonManufacturer: "Cameron",
    category: "Libre à air chaud",
  });
  assert.equal(resolveBalloonForFlight(REGISTERED_BALLOONS, "F-HOBA", "F-HLFM")?.id, "F-HOBA");
});

test("la migration conserve seulement les masses composant exactes", () => {
  const migrated = migrateBalloonRegistry({
    version: 2,
    activeBalloonId: "F-OLD",
    balloons: [{
      id: "F-OLD",
      registration: "F-OLD",
      manufacturer: "Cameron",
      model: "Z105",
      volumeM3: 2_973,
      color: "Bleu",
      isFavorite: true,
      emptyWeightKg: 900,
      documents: [],
      weights: { envelopeKg: 280, fullCylinders: [{ id: "c1", fullWeightKg: 60 }] },
    }],
  });
  assert.equal(migrated.version, BALLOON_REGISTRY_VERSION);
  assert.equal(migrated.activeBalloonId, "F-OLD");
  assert.equal(migrated.balloons[0].color, "Bleu");
  assert.equal(migrated.balloons[0].configurationLimitsConfirmed, false);
  assert.deepEqual(migrated.balloons[0].weights, {
    envelopeKg: 280,
    fullCylinders: [{ id: "c1", fullWeightKg: 60 }],
  });
  assert.equal(calculateBalloonWeight(migrated.balloons[0].weights), null);
});

test("le registre survit à une sérialisation de rechargement", () => {
  const added = addBalloonToRegistry({ version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null }, { ...input, applicableMtowKg: 952, configurationLimitsConfirmed: true }).registry;
  const restored = migrateBalloonRegistry(JSON.parse(JSON.stringify(added)));
  assert.deepEqual(restored, added);
  assert.equal(restored.balloons[0].configurationLimitsConfirmed, true);
});

test("une migration ne confirme jamais silencieusement les limites", () => {
  const legacy = migrateBalloonRegistry({
    version: 4,
    activeBalloonId: "F-HLFM",
    balloons: [{ ...createBalloon({ ...input, applicableMtowKg: 952, configurationLimitsConfirmed: true }), configurationLimitsConfirmed: true }],
  });
  assert.equal(legacy.balloons[0].configurationLimitsConfirmed, false);
});

test("un ballon de 415 kg retrouve exactement ses masses dans le formulaire", () => {
  const equippedWeights = {
    envelopeKg: 118,
    burnerKg: 45,
    basketKg: 124,
    fullCylinders: [
      { id: "c1", label: "Avant gauche", fullWeightKg: 32 },
      { id: "c2", label: "Avant droit", fullWeightKg: 32 },
      { id: "c3", label: "Arrière gauche", fullWeightKg: 32 },
      { id: "c4", label: "Arrière droit", fullWeightKg: 32 },
    ],
  };
  const stored = addBalloonToRegistry({ version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null }, { ...input, weights: equippedWeights }).registry;
  const restored = migrateBalloonRegistry(JSON.parse(JSON.stringify(stored))).balloons[0];
  assert.equal(calculateBalloonWeight(restored.weights), 415);
  assert.deepEqual(balloonMassFormDraft(restored), {
    envelope: "118",
    burner: "45",
    basket: "124",
    cylinders: [
      { id: "c1", label: "Avant gauche", weight: "32" },
      { id: "c2", label: "Avant droit", weight: "32" },
      { id: "c3", label: "Arrière gauche", weight: "32" },
      { id: "c4", label: "Arrière droit", weight: "32" },
    ],
  });
  const burnerChanged = updateBalloon(restored, { ...input, weights: { ...restored.weights, burnerKg: 50 } });
  assert.equal(burnerChanged.weights.envelopeKg, 118);
  assert.equal(burnerChanged.weights.basketKg, 124);
  assert.deepEqual(burnerChanged.weights.fullCylinders, restored.weights.fullCylinders);
  assert.equal(calculateBalloonWeight(burnerChanged.weights), 420);
  const identityChanged = updateBalloon(restored, { ...input, registration: "F-NEWX", weights: restored.weights });
  assert.deepEqual(identityChanged.weights, restored.weights);
});

test("la création reste vide et la sauvegarde attend la fin de l'hydratation", () => {
  assert.deepEqual(balloonMassFormDraft(undefined), { envelope: "", burner: "", basket: "", cylinders: [] });
  assert.equal(canSubmitHydratedBalloonForm(false, true), false);
  assert.equal(canSubmitHydratedBalloonForm(true, true), true);
});

test("la migration récupère uniquement les anciennes masses dont la correspondance est certaine", () => {
  const migrated = migrateBalloonRegistry({
    version: 4,
    activeBalloonId: "F-OLD",
    balloons: [{
      id: "F-OLD", registration: "F-OLD", manufacturer: "Cameron", model: "Z105", volumeM3: 2_973,
      weights: {
        envelopeWeightKg: 118,
        burnerWeightKg: 45,
        basketWeightKg: 124,
        cylinders: [{ id: "legacy-1", label: "Cylindre historique", fullWeightKg: 128 }],
      },
    }],
  });
  assert.deepEqual(migrated.balloons[0].weights, { envelopeKg: 118, burnerKg: 45, basketKg: 124, fullCylinders: [{ id: "legacy-1", label: "Cylindre historique", fullWeightKg: 128 }] });
  assert.deepEqual(migrated.balloons[0].legacyWeightRecovery, { envelopeWeightKg: 118, burnerWeightKg: 45, basketWeightKg: 124, cylinders: [{ id: "legacy-1", label: "Cylindre historique", fullWeightKg: 128 }] });
  assert.equal(calculateBalloonWeight(migrated.balloons[0].weights), 415);
});
