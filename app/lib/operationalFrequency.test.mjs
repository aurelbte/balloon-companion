import assert from "node:assert/strict";
import test from "node:test";
import { selectOperationalFrequency } from "./operationalFrequency.ts";
import { getAirspaceBadgePresentation } from "./flightContext.ts";

function airspace(type, frequencies, name = "LILLE") {
  return {
    id: `airspace-${type}`,
    airspaceId: `airspace-${type}`,
    airspaceCompositeKey: `${name}|${type}`,
    name,
    type,
    typeLabel: "Test",
    icaoClass: 3,
    icaoClassLabel: "D",
    lowerLimit: null,
    upperLimit: null,
    lowerLimitMin: null,
    upperLimitMax: null,
    frequencies,
    remarks: null,
    country: "FR",
    activity: null,
    onDemand: null,
    onRequest: null,
    byNotam: null,
    activeFrom: null,
    activeUntil: null,
  };
}

function flightContext(currentAirspace) {
  const current = currentAirspace
    ? {
        airspace: currentAirspace,
        horizontalState: "INSIDE",
        verticalContext: {
          state: "INSIDE",
          currentAltitudeMeters: 300,
          verticalAccuracyMeters: 10,
          distanceToFloorMeters: 300,
          distanceToCeilingMeters: 1000,
          isFloorComparable: true,
          isCeilingComparable: true,
        },
        isVerticallyConfirmed: true,
        displayPriority: 20,
      }
    : null;

  return {
    gps: {
      latitude: 50.63,
      longitude: 3.05,
      altitudeMeters: 300,
      horizontalAccuracyMeters: 6,
      verticalAccuracyMeters: 10,
      timestamp: 1,
      status: "ACTIVE",
    },
    airspace: {
      current,
      containing: current ? [current] : [],
      horizontalCandidates: current ? [current] : [],
      status: current ? "CONFIRMED" : "NO_MATCH",
    },
  };
}

const frequency = (value, name, primary = false) => ({
  value,
  unit: 0,
  name,
  primary,
});

test("CTR : TWR est prioritaire sur APP et INFO", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(4, [
        frequency("120.275", "LILLE INFO"),
        frequency("119.700", "LILLE APP"),
        frequency("118.550", "LILLE TWR"),
      ]),
    ),
  );
  assert.equal(result.value, "118.550");
  assert.equal(result.role, "TWR");
});

test("CTR : utilise APP puis INFO en fallback", () => {
  const appResult = selectOperationalFrequency(
    flightContext(
      airspace(4, [
        frequency("120.275", "LILLE INFO"),
        frequency("119.700", "LILLE APP"),
      ]),
    ),
  );
  assert.equal(appResult.value, "119.700");

  const infoResult = selectOperationalFrequency(
    flightContext(airspace(4, [frequency("120.275", "LILLE INFO")])),
  );
  assert.equal(infoResult.value, "120.275");
});

test("CTR : conserve une fréquence officielle unique sans rôle reconnu", () => {
  const result = selectOperationalFrequency(
    flightContext(airspace(4, [frequency("118.550", "LILLE")])),
  );
  assert.equal(result.value, "118.550");
  assert.equal(result.reason, "UNIQUE_OFFICIAL_FREQUENCY");
});

test("TMA : APP est prioritaire sur RADAR et CONTROL", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(7, [
        frequency("124.000", "LILLE CONTROL"),
        frequency("126.000", "LILLE RADAR"),
        frequency("120.275", "LILLE APP"),
      ]),
    ),
  );
  assert.equal(result.value, "120.275");
  assert.equal(result.role, "APP");
});

test("CTA : CONTROL est prioritaire sur APP", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(26, [
        frequency("120.275", "LILLE APP"),
        frequency("124.000", "LILLE CONTROL"),
      ]),
    ),
  );
  assert.equal(result.value, "124.000");
});

test("ATZ : AFIS est prioritaire sur INFO", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(13, [
        frequency("123.500", "LILLE INFO"),
        frequency("122.600", "LILLE AFIS"),
      ]),
    ),
  );
  assert.equal(result.value, "122.600");
});

test("FIS : privilégie l’organisme local et rejette l’organisme éloigné", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(
        33,
        [
          frequency("126.100", "PARIS INFO"),
          frequency("120.275", "LILLE INFO"),
        ],
        "SIV LILLE",
      ),
    ),
  );
  assert.equal(result.value, "120.275");
  assert.equal(result.stationName, "LILLE INFO");
});

test("FIS : n’affiche rien lorsque la localité ne peut pas être confirmée", () => {
  const result = selectOperationalFrequency(
    flightContext(
      airspace(33, [frequency("126.100", "PARIS INFO")], "SIV LILLE"),
    ),
  );
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "FIS_LOCALITY_UNCONFIRMED");
});

test("ne sélectionne aucune fréquence absente ou ambiguë", () => {
  const absent = selectOperationalFrequency(
    flightContext(airspace(7, [])),
  );
  assert.equal(absent.status, "UNAVAILABLE");

  const ambiguous = selectOperationalFrequency(
    flightContext(
      airspace(7, [
        frequency("119.700", "LILLE APP"),
        frequency("120.500", "LILLE APP"),
      ]),
    ),
  );
  assert.equal(ambiguous.status, "UNAVAILABLE");
});

test("ne sélectionne rien sans espace courant", () => {
  const result = selectOperationalFrequency(flightContext(null));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "NO_CURRENT_AIRSPACE");
});

test("compose la pastille CTR sans séparateur inutile", () => {
  const context = flightContext(
    airspace(4, [frequency("118.550", "LILLE TWR")]),
  );
  const operational = selectOperationalFrequency(context);

  assert.equal(
    getAirspaceBadgePresentation(context, operational).label,
    "CTR LILLE · D · 118.550",
  );
});

test("compose la pastille FIS avec l’organisme local", () => {
  const context = flightContext(
    airspace(
      33,
      [frequency("120.275", "LILLE INFO")],
      "SIV LILLE",
    ),
  );
  const operational = selectOperationalFrequency(context);

  assert.equal(
    getAirspaceBadgePresentation(context, operational).label,
    "LILLE INFO · 120.275",
  );
});
