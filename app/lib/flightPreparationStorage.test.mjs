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

test("conserve un taux de descente V2 sans ajouter de scénario de descente", () => {
  const migrated = migrateStoredPreparation({
    storageVersion: PREPARATION_STORAGE_VERSION,
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

  assert.equal(migrated?.descentRateMps, 1.1);
  assert.equal("descentStartsAt" in migrated, false);
});
