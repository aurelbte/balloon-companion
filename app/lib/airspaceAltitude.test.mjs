import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAirspaceVerticalContext,
  normalizeOpenAipAltitudeLimit,
} from "./airspaceAltitude.ts";

const sfc = normalizeOpenAipAltitudeLimit({
  value: 0,
  unit: 1,
  referenceDatum: 0,
});
const floor1000m = normalizeOpenAipAltitudeLimit({
  value: 1000,
  unit: 0,
  referenceDatum: 1,
});
const ceiling2000m = normalizeOpenAipAltitudeLimit({
  value: 2000,
  unit: 0,
  referenceDatum: 1,
});

test("converts a 2500 ft AMSL ceiling and computes its margin", () => {
  const ceiling = normalizeOpenAipAltitudeLimit({
    value: 2500,
    unit: 1,
    referenceDatum: 1,
  });
  const context = calculateAirspaceVerticalContext(sfc, ceiling, 500);

  assert.equal(ceiling.metersAMSL, 762);
  assert.equal(context.state, "INSIDE");
  assert.equal(context.distanceToCeilingMeters, 262);
});

test("detects a pilot below an AMSL floor", () => {
  const context = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    810
  );
  assert.equal(context.state, "BELOW");
  assert.equal(context.distanceToFloorMeters, 190);
});

test("detects a pilot inside AMSL limits", () => {
  const context = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    1500
  );
  assert.equal(context.state, "INSIDE");
  assert.equal(context.distanceToCeilingMeters, 500);
});

test("detects a pilot above an AMSL ceiling", () => {
  const context = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    2075
  );
  assert.equal(context.state, "ABOVE");
  assert.equal(context.distanceToCeilingMeters, 75);
});

test("accepts SFC as a satisfied floor without inventing AMSL", () => {
  const context = calculateAirspaceVerticalContext(sfc, ceiling2000m, 500);
  assert.equal(sfc.reference, "SFC");
  assert.equal(sfc.metersAMSL, null);
  assert.equal(context.state, "INSIDE");
  assert.equal(context.distanceToFloorMeters, null);
});

test("does not compare an AGL limit to GPS AMSL", () => {
  const agl = normalizeOpenAipAltitudeLimit({
    value: 500,
    unit: 1,
    referenceDatum: 0,
  });
  const context = calculateAirspaceVerticalContext(agl, ceiling2000m, 500);
  assert.equal(agl.reference, "AGL");
  assert.equal(context.state, "UNKNOWN");
});

test("does not convert a flight level", () => {
  const flightLevel = normalizeOpenAipAltitudeLimit({
    value: 65,
    unit: 6,
    referenceDatum: 2,
  });
  const context = calculateAirspaceVerticalContext(sfc, flightLevel, 500);
  assert.equal(flightLevel.displayLabel, "FL 65");
  assert.equal(flightLevel.metersAMSL, null);
  assert.equal(context.state, "UNKNOWN");
});

test("returns unknown when GPS altitude is missing", () => {
  const context = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    null
  );
  assert.equal(context.state, "UNKNOWN");
});

test("handles incomplete or unknown OpenAIP limits", () => {
  const missing = normalizeOpenAipAltitudeLimit(undefined);
  const unknown = normalizeOpenAipAltitudeLimit({
    value: 500,
    unit: 99,
    referenceDatum: 99,
  });
  assert.equal(missing.reference, "UNKNOWN");
  assert.equal(unknown.reference, "UNKNOWN");
  assert.equal(unknown.metersAMSL, null);
});

test("treats exact floor and ceiling boundaries as inside", () => {
  const atFloor = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    1000
  );
  const atCeiling = calculateAirspaceVerticalContext(
    floor1000m,
    ceiling2000m,
    2000
  );

  assert.equal(atFloor.state, "INSIDE");
  assert.equal(atFloor.distanceToFloorMeters, 0);
  assert.equal(atCeiling.state, "INSIDE");
  assert.equal(atCeiling.distanceToCeilingMeters, 0);
});
