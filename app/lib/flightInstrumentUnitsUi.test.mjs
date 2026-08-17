import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getRecordedFlightPresentation } from "./recordedFlightPresentation.ts";
import { getFlightAltitudeReadings } from "./unitPreferences.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const flight = {
  id: "flight-units", startedAt: "2026-08-14T10:00:00Z", endedAt: "2026-08-14T11:00:00Z", points: [{ latitude: 50, longitude: 3 }],
  summary: { durationSeconds: 3600, distanceMeters: 8890, minAltitudeMeters: 100, maxAltitudeMeters: 300, averageGroundSpeedMetersPerSecond: 5, maxGroundSpeedMetersPerSecond: 10 },
};

test("les instruments temps réel utilisent les trois préférences sans toucher au vario", () => {
  const instruments = source("../components/flight/FlightInstruments.tsx");
  assert.match(instruments, /units\.flightInstruments\.speedUnit/);
  assert.match(instruments, /units\.flightInstruments\.altitudeUnit/);
  assert.match(instruments, /units\.flightInstruments\.distanceUnit/);
  assert.match(instruments, /unit: "m\/s"/);
});

test("la préférence altitude choisit seulement la lecture principale de la même mesure GPS", () => {
  assert.deepEqual(getFlightAltitudeReadings(350, "m"), { primary: { value: "350", unit: "m" }, secondary: { value: "1 148", unit: "ft" } });
  assert.deepEqual(getFlightAltitudeReadings(350, "ft"), { primary: { value: "1 148", unit: "ft" }, secondary: { value: "350", unit: "m" } });
  assert.equal(getFlightAltitudeReadings(Number.NaN, "ft"), null);
});

test("VENTS sépare Prévu météo et Observé instruments et convertit uniquement les libellés d'altitude", () => {
  const panel = source("../components/flight/WindProfilePanel.tsx");
  assert.match(panel, /formatWeatherWind\([^\n]+units\.weather\.windSpeedUnit/);
  assert.match(panel, /formatFlightSpeed\([^\n]+units\.flightInstruments\.speedUnit/);
  assert.match(panel, /formatFlightAltitude\(level, units\.flightInstruments\.altitudeUnit\)/);
  assert.match(panel, /level === 0 \? "Sol"/);
});

test("Prépa et popup gardent les couches météo en mètres, avec distance en km/NM", () => {
  const popup = source("../components/TrajectoryArrivalDetails.tsx");
  const preparation = source("../map/page.tsx");
  assert.match(popup, /formatFlightDistance/);
  assert.match(popup, /<strong>\{trace\.label\} · \{trace\.model\.label\}/);
  assert.match(preparation, /altitude === "ground" \? "Sol" : `\$\{altitude\} m`/);
  assert.doesNotMatch(preparation, /formatFlightAltitude|flightInstruments\.altitudeUnit/);
  assert.doesNotMatch(popup, /formatFlightAltitude|flightInstruments\.altitudeUnit/);
  assert.match(popup, /normalizeOpenAipAltitudeLimit\(airspace\.lowerLimit\)\.displayLabel/);
  assert.doesNotMatch(source("../components/flight/AirspaceDetails.tsx"), /useUnitPreferences|formatFlightAltitude/);
});

test("Mode Vol et VENTS continuent à suivre l'altitude Instruments", () => {
  assert.match(source("../components/flight/FlightInstruments.tsx"), /units\.flightInstruments\.altitudeUnit/);
  assert.match(source("../components/flight/WindProfilePanel.tsx"), /formatFlightAltitude\(level, units\.flightInstruments\.altitudeUnit\)/);
  assert.match(source("../components/flight/PlannedTrajectoriesInfo.tsx"), /formatFlightAltitude\(altitude\.altitudeAmslM, units\.flightInstruments\.altitudeUnit\)/);
});

test("un RecordedFlight reste canonique tandis que sa présentation change", () => {
  const original = structuredClone(flight);
  const metric = getRecordedFlightPresentation(flight);
  const pilot = getRecordedFlightPresentation(flight, "fr-FR", { speedUnit: "kt", altitudeUnit: "ft", distanceUnit: "NM" });
  assert.equal(metric.distance, "8.89 km");
  assert.equal(metric.maxAltitude, "300 m");
  assert.equal(pilot.distance, "4.80 NM");
  assert.equal(pilot.maxAltitude, "984 ft");
  assert.equal(pilot.maxGroundSpeed, "19.4 kt");
  assert.deepEqual(flight, original);
});

test("Journal et résumés enregistrés utilisent les helpers centraux", () => {
  for (const path of ["../components/journal/JournalFlightDetail.tsx", "../components/journal/JournalFlightStatistics.tsx", "../components/journal/JournalFlightList.tsx", "../components/journal/JournalFlightGraphs.tsx", "../components/flight/RecordedFlightSummaryCard.tsx"]) {
    assert.match(source(path), /useUnitPreferences/);
  }
});

test("Cockpit météo, METAR et TAF restent hors des préférences Instruments", () => {
  assert.doesNotMatch(source("../components/cockpit/ConditionsCard.tsx"), /flightInstruments/);
  const weatherPage = source("../weather/page.tsx");
  const aviation = weatherPage.slice(weatherPage.indexOf("function TafPeriod"), weatherPage.indexOf("function AviationAirportPicker"));
  assert.doesNotMatch(aviation, /flightInstruments|formatFlight/);
});
