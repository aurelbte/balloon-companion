import assert from "node:assert/strict";
import test from "node:test";
import {
  FLIGHT_TRACK_STYLE,
  GPS_PROJECTION_STYLE,
  getFollowCameraOffset,
  getFollowPositionAfterAction,
  getMapCameraInsets,
  getMapOptionsOpenAfterAction,
  getVisibleProjectionMinutes,
  isMapDisplayCustomized,
  shouldApplyInitialCenter,
  shouldSuspendFollowForDrag,
  toggleMapLayerSetting,
} from "./flightMapPresentation.ts";

const projection = [5, 10, 20, 30, 60].map((minutes) => ({
  minutes,
  latitude: 50 + minutes / 100,
  longitude: 3 + minutes / 100,
}));

test("ancre la position à environ 35 % du bas de la zone utile", () => {
  const size = { width: 402, height: 874 };
  const [, offsetY] = getFollowCameraOffset(size);
  const insets = getMapCameraInsets(size);
  const anchorY = size.height / 2 + offsetY;
  const usefulHeight = size.height - insets.top - insets.bottom;
  const distanceFromUsefulBottom = size.height - insets.bottom - anchorY;

  assert.ok(Math.abs(distanceFromUsefulBottom / usefulHeight - 0.35) < 0.02);
});

test("le zoom manuel ne suspend pas le suivi", () => {
  assert.equal(
    shouldSuspendFollowForDrag({ isZooming: true, touchCount: 2 }),
    false,
  );
  assert.equal(getFollowPositionAfterAction(true, "ZOOM"), true);
});

test("un glisser-déposer manuel suspend le suivi", () => {
  assert.equal(
    shouldSuspendFollowForDrag({ isZooming: false, touchCount: 1 }),
    true,
  );
  assert.equal(getFollowPositionAfterAction(true, "MANUAL_DRAG"), false);
});

test("le premier GPS centre une fois, sans recentrage initial répété", () => {
  assert.equal(
    shouldApplyInitialCenter({
      hasValidPosition: true,
      alreadyCentered: false,
    }),
    true,
  );
  assert.equal(
    shouldApplyInitialCenter({
      hasValidPosition: true,
      alreadyCentered: true,
    }),
    false,
  );
});

test("recentrer et la vue élargie réactivent le suivi", () => {
  assert.equal(getFollowPositionAfterAction(false, "RECENTER"), true);
  assert.equal(getFollowPositionAfterAction(false, "FIT_PROJECTION"), true);
});

test("les traces terrain ont une largeur renforcée et hiérarchisée", () => {
  assert.ok(GPS_PROJECTION_STYLE.lineWidth >= 5);
  assert.ok(GPS_PROJECTION_STYLE.haloWidth > GPS_PROJECTION_STYLE.lineWidth);
  assert.ok(FLIGHT_TRACK_STYLE.lineWidth >= 5);
  assert.ok(FLIGHT_TRACK_STYLE.haloWidth > FLIGHT_TRACK_STYLE.lineWidth);
});

test("affiche 5/10/20/30 minutes localement et allège les faibles zooms", () => {
  assert.deepEqual(getVisibleProjectionMinutes(11, projection), [
    5, 10, 20, 30, 60,
  ]);
  assert.deepEqual(getVisibleProjectionMinutes(9, projection), [5, 10, 20, 30]);
  assert.deepEqual(getVisibleProjectionMinutes(6, projection), [5, 10, 20]);
});

test("n'invente aucun repère absent ou invalide", () => {
  assert.deepEqual(
    getVisibleProjectionMinutes(12, [
      projection[0],
      { minutes: 10, latitude: Number.NaN, longitude: 3 },
    ]),
    [5],
  );
});

test("détecte un affichage cartographique non standard", () => {
  assert.equal(
    isMapDisplayCustomized({
      baseMap: "plan",
      airspaces: false,
      highContrast: false,
    }),
    false,
  );
  assert.equal(
    isMapDisplayCustomized({
      baseMap: "satellite",
      airspaces: false,
      highContrast: false,
    }),
    true,
  );
  assert.equal(
    isMapDisplayCustomized({
      baseMap: "plan",
      airspaces: true,
      highContrast: false,
    }),
    true,
  );
});

test("le menu Carte s'ouvre, se referme et active les espaces aériens", () => {
  assert.equal(getMapOptionsOpenAfterAction(false, "TOGGLE"), true);
  assert.equal(getMapOptionsOpenAfterAction(true, "TOGGLE"), false);
  assert.equal(getMapOptionsOpenAfterAction(true, "MAP_PRESS"), false);
  assert.equal(getMapOptionsOpenAfterAction(true, "OUTSIDE_PRESS"), false);
  assert.equal(getMapOptionsOpenAfterAction(true, "ESCAPE"), false);

  const settings = {
    gpsProjection: true,
    weatherProjection: false,
    airspaces: false,
    aeronauticalMap: false,
    highContrast: false,
  };
  assert.equal(toggleMapLayerSetting(settings, "airspaces").airspaces, true);
  assert.equal(settings.airspaces, false);
});
