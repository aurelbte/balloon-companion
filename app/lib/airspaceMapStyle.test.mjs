import test from "node:test";
import assert from "node:assert/strict";
import {
  AIRSPACE_MAP_PALETTE,
  AIRSPACE_RENDER_ORDER,
  getAirspaceMapStyle,
  getAirspaceVisualCategory,
  getAirspaceZoomContext,
  isAirspaceCategoryVisibleAtZoom,
} from "./airspaceMapStyle.ts";

function airspace(type, name, lowerLimit = null) {
  return { type, name, lowerLimit };
}

test("classe CTR, TMA et CTA dans leurs catégories contrôlées", () => {
  assert.equal(getAirspaceVisualCategory(airspace(4, "CTR LILLE")), "CONTROLLED_LOCAL");
  assert.equal(getAirspaceVisualCategory(airspace(7, "TMA LILLE")), "CONTROLLED_TERMINAL");
  assert.equal(getAirspaceVisualCategory(airspace(26, "CTA PARIS")), "CONTROLLED_TERMINAL");
});

test("classe les zones P, R et D en RESTRICTED", () => {
  for (const type of [1, 2, 3]) {
    assert.equal(getAirspaceVisualCategory(airspace(type, "Zone")), "RESTRICTED");
  }
});

test("classe FIS Sector et SIV en INFORMATION_SERVICE sans confondre un FIR", () => {
  assert.equal(getAirspaceVisualCategory(airspace(33, "LILLE INFO")), "INFORMATION_SERVICE");
  assert.equal(getAirspaceVisualCategory(airspace(0, "SIV LILLE")), "INFORMATION_SERVICE");
  assert.equal(getAirspaceVisualCategory(airspace(10, "FIR FRANCE")), "UPPER_AIRSPACE");
});

test("classe LTA, FIR et UIR en UPPER_AIRSPACE", () => {
  for (const type of [10, 11, 34]) {
    assert.equal(getAirspaceVisualCategory(airspace(type, "Espace supérieur")), "UPPER_AIRSPACE");
  }
});

test("conserve un type inconnu dans UNKNOWN", () => {
  assert.equal(getAirspaceVisualCategory(airspace(999, "Mystère")), "UNKNOWN");
});

test("utilise le vert pour l'information et le rouge pour les restrictions", () => {
  assert.equal(
    getAirspaceMapStyle(airspace(33, "FIS"), 6, { currentAltitudeMeters: null }).color,
    AIRSPACE_MAP_PALETTE.INFORMATION_SERVICE,
  );
  assert.equal(
    getAirspaceMapStyle(airspace(1, "R 45"), 6, { currentAltitudeMeters: null }).color,
    AIRSPACE_MAP_PALETTE.RESTRICTED,
  );
});

test("supprime le remplissage si le plancher AMSL est clairement très supérieur", () => {
  const style = getAirspaceMapStyle(
    airspace(7, "TMA HAUTE", { value: 1500, unit: 0, referenceDatum: 1 }),
    9,
    { currentAltitudeMeters: 200, verticalAccuracyMeters: 30 },
  );
  assert.equal(style.verticalRelevance, "ABOVE_FAR");
  assert.equal(style.fillOpacity, 0);
});

test("ne déduit rien pour un plancher FL ou AGL", () => {
  for (const lowerLimit of [
    { value: 65, unit: 6, referenceDatum: 2 },
    { value: 1000, unit: 1, referenceDatum: 0 },
  ]) {
    const style = getAirspaceMapStyle(airspace(7, "TMA", lowerLimit), 9, {
      currentAltitudeMeters: 100,
    });
    assert.equal(style.verticalRelevance, "UNKNOWN");
    assert.ok(style.fillOpacity > 0);
  }
});

test("conserve un ordre de rendu stable du fond vers les restrictions", () => {
  assert.deepEqual(AIRSPACE_RENDER_ORDER, [
    "UNKNOWN",
    "INFORMATION_SERVICE",
    "UPPER_AIRSPACE",
    "CONTROLLED_TERMINAL",
    "CONTROLLED_LOCAL",
    "RESTRICTED",
  ]);
});

test("en vue nationale, masque les zones rouges et les espaces contrôlés", () => {
  assert.equal(isAirspaceCategoryVisibleAtZoom("RESTRICTED", 5), false);
  assert.equal(isAirspaceCategoryVisibleAtZoom("CONTROLLED_LOCAL", 5), false);
  assert.equal(
    isAirspaceCategoryVisibleAtZoom("CONTROLLED_TERMINAL", 5),
    false,
  );
  assert.equal(
    isAirspaceCategoryVisibleAtZoom("INFORMATION_SERVICE", 5),
    true,
  );
  const upper = getAirspaceMapStyle(airspace(10, "FIR"), 5, {
    currentAltitudeMeters: null,
  });
  assert.equal(upper.visible, true);
  assert.equal(upper.fillOpacity, 0);
  assert.ok(upper.lineOpacity <= 0.4);
});

test("applique les seuils national, régional et local", () => {
  assert.equal(getAirspaceZoomContext(5), "NATIONAL");
  assert.equal(getAirspaceZoomContext(7), "REGIONAL");
  assert.equal(getAirspaceZoomContext(10), "LOCAL");

  assert.equal(getAirspaceMapStyle(airspace(33, "FIS"), 5, { currentAltitudeMeters: null }).visible, true);
  assert.equal(getAirspaceMapStyle(airspace(7, "TMA"), 5, { currentAltitudeMeters: null }).visible, false);
  assert.equal(getAirspaceMapStyle(airspace(1, "R"), 5, { currentAltitudeMeters: null }).visible, false);
  assert.equal(getAirspaceMapStyle(airspace(7, "TMA"), 7, { currentAltitudeMeters: null }).visible, true);
  assert.equal(getAirspaceMapStyle(airspace(1, "R"), 7, { currentAltitudeMeters: null }).visible, true);
  assert.equal(getAirspaceMapStyle(airspace(4, "CTR"), 7, { currentAltitudeMeters: null }).visible, false);
  assert.equal(getAirspaceMapStyle(airspace(4, "CTR"), 9, { currentAltitudeMeters: null }).visible, true);
  assert.equal(getAirspaceMapStyle(airspace(34, "LTA"), 9, { currentAltitudeMeters: null }).visible, false);
});
