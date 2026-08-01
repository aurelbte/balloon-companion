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
} from "./balloons.ts";
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
  assert.equal(BALLOON_CATALOG.length, 1);
  assert.deepEqual(catalogModels("Cameron").map(({ model }) => model), ["Z105", "Z150", "Z350"]);
  assert.equal(catalogVolume("Cameron", "Z105"), 2_973);
  assert.equal(catalogVolume("Cameron", "Z150"), 4_247);
  assert.equal(catalogVolume("Cameron", "Z350"), 9_911);
  assert.equal(catalogVolume("Autre", "Libre"), null);
});

test("les ballons de démonstration restent incomplets sans masses inventées", () => {
  assert.equal(REGISTERED_BALLOONS.length, 4);
  assert.equal(balloonDisplayName(REGISTERED_BALLOONS[0]), "F-HLFM • Cameron Z105");
  assert.equal(REGISTERED_BALLOONS[0].volumeM3, 2_973);
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
  assert.deepEqual(migrated.balloons[0].weights, {
    envelopeKg: 280,
    fullCylinders: [{ id: "c1", fullWeightKg: 60 }],
  });
  assert.equal(calculateBalloonWeight(migrated.balloons[0].weights), null);
});

test("le registre survit à une sérialisation de rechargement", () => {
  const added = addBalloonToRegistry({ version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null }, input).registry;
  const restored = migrateBalloonRegistry(JSON.parse(JSON.stringify(added)));
  assert.deepEqual(restored, added);
});
