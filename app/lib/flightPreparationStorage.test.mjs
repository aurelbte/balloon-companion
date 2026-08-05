import test from "node:test";
import assert from "node:assert/strict";
import {
  PREPARATION_STORAGE_VERSION,
  migrateStoredPreparation,
} from "./flightStorage.ts";

test("migre un ancien stockage sans inventer coordonnées ou altitude", () => {
  const migrated = migrateStoredPreparation(
    {
      terrain: "Bondues",
      date: "2026-07-27",
      heure: "06:15",
      duree: "45 min",
      ballon: "Cameron Z-105",
      meteo: "AROME",
      createdAt: 10,
      updatedAt: 20,
    },
    30,
  );

  assert.equal(migrated?.storageVersion, PREPARATION_STORAGE_VERSION);
  assert.equal(migrated?.launchSite, null);
  assert.equal(migrated?.unresolvedLaunchSiteName, "Bondues");
  assert.equal(migrated?.targetAltitudeAmslM, null);
  assert.equal(migrated?.weatherModel, "arome_seamless");
  assert.equal(migrated?.durationMinutes, 45);
  assert.equal(migrated?.createdAt, 10);
});

test("migre un ancien taux moteur V2 vers l'intention pilote signée", () => {
  const migrated = migrateStoredPreparation({
    storageVersion: 2,
    launchSite: {
      name: "Point confirmé",
      latitude: 50.6,
      longitude: 3.1,
      terrainAltitudeAmslM: 42,
    },
    departureTime: "2026-07-27T04:15:00.000Z",
    durationMinutes: 45,
    weatherModel: "icon_seamless",
    targetAltitudeAmslM: 300,
    descentRateMps: 1.1,
    createdAt: 10,
    updatedAt: 20,
  });

  assert.equal(migrated?.descentRateMps, -1.1);
  assert.equal("descentStartsAt" in migrated, false);
});

test("convertit sans confusion les intentions V2 en mètres par minute", () => {
  const migrated = migrateStoredPreparation({
    storageVersion: 2,
    launchSite: { name: "Bondues", latitude: 50.68, longitude: 3.08 },
    departureTime: "2026-08-05T04:30:00.000Z",
    durationMinutes: 60,
    weatherModel: "arome_seamless",
    targetAltitudeAmslM: null,
    ascentRateMPerMin: 150,
    descentRateMPerMin: 100,
    createdAt: 10,
    updatedAt: 20,
  });
  assert.equal(migrated?.ascentRateMps, 2.5);
  assert.equal(migrated?.descentRateMps, -100 / 60);
});

test("conserve les taux canoniques V3 signés", () => {
  const migrated = migrateStoredPreparation({
    storageVersion: PREPARATION_STORAGE_VERSION,
    launchSite: { name: "Bondues", latitude: 50.68, longitude: 3.08 },
    departureTime: "2026-08-05T04:30:00.000Z",
    durationMinutes: 60,
    weatherModel: "arome_seamless",
    targetAltitudeAmslM: null,
    ascentRateMps: 2,
    descentRateMps: -3,
    createdAt: 10,
    updatedAt: 20,
  });
  assert.equal(migrated?.ascentRateMps, 2);
  assert.equal(migrated?.descentRateMps, -3);
});
