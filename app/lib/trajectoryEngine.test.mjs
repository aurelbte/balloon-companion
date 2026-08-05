import test from "node:test";
import assert from "node:assert/strict";
import { calculateDistance } from "./geo.ts";
import {
  DEFAULT_TRAJECTORY_STEP_SECONDS,
  projectConstantAltitudeTrajectory,
} from "./trajectory/engine.ts";
import { TrajectoryDomainError } from "./trajectory/types.ts";

function validInput(overrides = {}) {
  return {
    start: {
      name: "Bondues",
      latitude: 50.631,
      longitude: 3.058,
      terrainAltitudeAmslM: 24,
    },
    departureTime: "2026-07-27T06:00:00+02:00",
    durationSeconds: 60,
    weatherModel: "arome_seamless",
    targetAltitudeAmslM: 300,
    ...overrides,
  };
}

function windSample(query, wind = { speedMps: 5, directionFromDeg: 270 }) {
  return {
    query,
    wind,
    sourceModel: query.weatherModel,
    sourceLatitude: query.latitude,
    sourceLongitude: query.longitude,
    sourceSlices: [
      {
        validAt: query.validAt,
        wind,
        lowerLevel: {
          pressureHpa: 1000,
          geopotentialHeightAmslM: 100,
          windSpeedMps: wind.speedMps,
          windDirectionFromDeg: wind.directionFromDeg,
        },
        upperLevel: {
          pressureHpa: 950,
          geopotentialHeightAmslM: 500,
          windSpeedMps: wind.speedMps,
          windDirectionFromDeg: wind.directionFromDeg,
        },
        verticalInterpolationRatio: 0.5,
      },
    ],
    warnings: [],
  };
}

function fakeProvider(
  wind = { speedMps: 5, directionFromDeg: 270 },
  failAtCall,
) {
  const queries = [];
  return {
    queries,
    async getWind(query) {
      queries.push(query);
      if (queries.length === failAtCall) {
        throw new TrajectoryDomainError(
          "MISSING_WIND_DATA",
          "Vent indisponible.",
        );
      }
      return windSample(query, wind);
    },
  };
}

test("le pas par défaut vaut exactement 20 secondes", () => {
  assert.equal(DEFAULT_TRAJECTORY_STEP_SECONDS, 20);
});

test("un vent calme ne produit aucune dérive", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider({ speedMps: 0, directionFromDeg: 0 }),
  );
  for (const point of result.points) {
    assert.equal(point.latitude, 50.631);
    assert.equal(point.longitude, 3.058);
  }
});

test("un vent constant donne une trajectoire reproductible et la bonne distance", async () => {
  const first = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider({ speedMps: 5, directionFromDeg: 270 }),
  );
  const second = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider({ speedMps: 5, directionFromDeg: 270 }),
  );
  assert.deepEqual(first, second);
  const end = first.points.at(-1);
  const distanceMeters =
    calculateDistance(50.631, 3.058, end.latitude, end.longitude) * 1000;
  assert.ok(Math.abs(distanceMeters - 300) < 0.01);
});

test("un vent du nord déplace la trajectoire vers le sud", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider({ speedMps: 5, directionFromDeg: 0 }),
  );
  assert.ok(result.points.at(-1).latitude < 50.631);
});

test("un vent d’ouest déplace la trajectoire vers l’est", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider({ speedMps: 5, directionFromDeg: 270 }),
  );
  assert.ok(result.points.at(-1).longitude > 3.058);
});

test("60 secondes à pas de 20 créent le point initial et trois segments", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider(),
  );
  assert.equal(result.points.length, 4);
  assert.deepEqual(
    result.points.map((point) => point.elapsedSeconds),
    [0, 20, 40, 60],
  );
});

test("le dernier pas de 55 secondes est raccourci à 15 secondes", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({ durationSeconds: 55 }),
    fakeProvider(),
  );
  assert.deepEqual(
    result.points.map((point) => point.elapsedSeconds),
    [0, 20, 40, 55],
  );
  assert.equal(result.endedAt, "2026-07-27T04:00:55.000Z");
});

test("sans taux vertical, tous les points restent à l’altitude cible", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider(),
  );
  assert.deepEqual(
    result.points.map((point) => point.altitudeAmslM),
    [300, 300, 300, 300],
  );
});

test("une montée seule part du terrain, atteint la cible puis reste en palier", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 100,
      targetAltitudeAmslM: 184,
      climbRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.equal(result.mode, "climb-then-level");
  assert.equal(result.points[0].altitudeAmslM, 24);
  assert.equal(result.verticalProfile.climbDurationSeconds, 40);
  assert.deepEqual(
    result.points.map((point) => point.altitudeAmslM),
    [24, 104, 184, 184, 184, 184],
  );
  assert.equal(result.points.at(-1).altitudeAmslM, 184);
});

test("une descente seule commence au temps calculé et atteint exactement le terrain", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 100,
      targetAltitudeAmslM: 184,
      descentRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.equal(result.mode, "level-then-descent");
  assert.equal(result.points[0].altitudeAmslM, 184);
  assert.equal(result.verticalProfile.descentStartElapsedSeconds, 60);
  assert.equal(result.points.at(-1).elapsedSeconds, 100);
  assert.equal(result.points.at(-1).altitudeAmslM, 24);
});

test("montée, palier et descente apparaissent dans cet ordre", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 120,
      targetAltitudeAmslM: 184,
      climbRateMps: 4,
      descentRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.equal(result.mode, "climb-level-descent");
  assert.deepEqual(
    [...new Set(result.points.slice(1).map((point) => point.verticalPhase))],
    ["climb", "level", "descent"],
  );
});

test("une montée à 4 m/s gagne 80 m par segment nominal de 20 secondes", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 80,
      targetAltitudeAmslM: 264,
      climbRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.deepEqual(
    result.points.slice(0, 4).map((point) => point.altitudeAmslM),
    [24, 104, 184, 264],
  );
});

test("le vent de montée est demandé à l’altitude moyenne du segment", async () => {
  const provider = fakeProvider();
  await projectConstantAltitudeTrajectory(
    validInput({
      start: {
        name: "Terrain",
        latitude: 50.631,
        longitude: 3.058,
        terrainAltitudeAmslM: 100,
      },
      durationSeconds: 40,
      targetAltitudeAmslM: 180,
      climbRateMps: 4,
    }),
    provider,
  );
  assert.equal(provider.queries[0].altitudeAmslM, 140);
});

test("le vent de descente est demandé à l’altitude moyenne du segment", async () => {
  const provider = fakeProvider();
  await projectConstantAltitudeTrajectory(
    validInput({
      start: {
        name: "Terrain",
        latitude: 50.631,
        longitude: 3.058,
        terrainAltitudeAmslM: 100,
      },
      durationSeconds: 370,
      targetAltitudeAmslM: 800,
      descentRateMps: 2,
    }),
    provider,
  );
  assert.equal(provider.queries[1].validAt, "2026-07-27T04:00:20.000Z");
  assert.equal(provider.queries[1].altitudeAmslM, 780);
});

test("une fin de montée au milieu du pas coupe précisément le segment", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 50,
      targetAltitudeAmslM: 124,
      climbRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.deepEqual(
    result.points.map((point) => point.elapsedSeconds),
    [0, 20, 25, 45, 50],
  );
  assert.deepEqual(
    result.points.map((point) => point.altitudeAmslM),
    [24, 104, 124, 124, 124],
  );
});

test("un début de descente au milieu du pas coupe précisément le palier", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 65,
      targetAltitudeAmslM: 124,
      descentRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.equal(result.verticalProfile.descentStartElapsedSeconds, 40);
  assert.deepEqual(
    result.points.map((point) => point.elapsedSeconds),
    [0, 20, 40, 60, 65],
  );
  assert.deepEqual(
    result.points.slice(1).map((point) => point.verticalPhase),
    ["level", "level", "descent", "descent"],
  );
});

test("une durée de montée décimale reste une frontière exacte", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 300,
      start: {
        name: "Terrain",
        latitude: 50.631,
        longitude: 3.058,
        terrainAltitudeAmslM: 100,
      },
      targetAltitudeAmslM: 800,
      climbRateMps: 3,
    }),
    fakeProvider(),
  );
  const expectedDuration = 700 / 3;
  assert.equal(result.verticalProfile.climbDurationSeconds, expectedDuration);
  const climbEnd = result.points.find(
    (point) => point.elapsedSeconds === expectedDuration,
  );
  assert.equal(climbEnd.altitudeAmslM, 800);
});

test("une durée de descente décimale arrive exactement au terrain", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 300,
      start: {
        name: "Terrain",
        latitude: 50.631,
        longitude: 3.058,
        terrainAltitudeAmslM: 100,
      },
      targetAltitudeAmslM: 800,
      descentRateMps: 3,
    }),
    fakeProvider(),
  );
  assert.equal(result.verticalProfile.descentDurationSeconds, 700 / 3);
  assert.equal(result.points.at(-1).altitudeAmslM, 100);
  assert.equal(result.points.at(-1).elapsedSeconds, 300);
});

test("une durée insuffisante est refusée avant toute préparation météo", async () => {
  let preparations = 0;
  const provider = {
    async prepareProjection() {
      preparations += 1;
      return fakeProvider();
    },
    async getWind(query) {
      return windSample(query);
    },
  };
  await assert.rejects(
    projectConstantAltitudeTrajectory(
      validInput({
        durationSeconds: 60,
        climbRateMps: 3,
        descentRateMps: 4,
      }),
      provider,
    ),
    { code: "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE" },
  );
  assert.equal(preparations, 0);
});

test("le scénario Bondues 60 min accepte +2 m/s et -3 m/s", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 60 * 60,
      targetAltitudeAmslM: 1000,
      climbRateMps: 2,
      descentRateMps: 3,
    }),
    fakeProvider(),
  );
  assert.equal(result.mode, "climb-level-descent");
  assert.equal(result.verticalProfile.climbDurationSeconds, 488);
  assert.equal(result.verticalProfile.descentDurationSeconds, 976 / 3);
  assert.equal(result.points.at(-1).altitudeAmslM, 24);
  assert.equal(result.points.at(-1).elapsedSeconds, 3600);
});

test("le profil 0/0 diffère du profil +10/-10 sans allonger le vol", async () => {
  const base = validInput({ durationSeconds: 3600, targetAltitudeAmslM: 1000 });
  const constant = await projectConstantAltitudeTrajectory(base, fakeProvider());
  const vertical = await projectConstantAltitudeTrajectory(
    { ...base, climbRateMps: 10, descentRateMps: 10 },
    fakeProvider(),
  );
  assert.equal(constant.mode, "constant-altitude");
  assert.equal(vertical.mode, "climb-level-descent");
  assert.notDeepEqual(vertical.verticalProfile, constant.verticalProfile);
  assert.equal(vertical.durationSeconds, constant.durationSeconds);
  assert.equal(vertical.points.at(-1).elapsedSeconds, 3600);
});

test("une montée sans altitude terrain est refusée explicitement", async () => {
  await assert.rejects(
    projectConstantAltitudeTrajectory(
      validInput({
        start: {
          name: "Terrain",
          latitude: 50.631,
          longitude: 3.058,
        },
        climbRateMps: 2,
      }),
      fakeProvider(),
    ),
    { code: "TERRAIN_ALTITUDE_REQUIRED" },
  );
});

test("une descente sans altitude terrain est refusée explicitement", async () => {
  await assert.rejects(
    projectConstantAltitudeTrajectory(
      validInput({
        start: {
          name: "Terrain",
          latitude: 50.631,
          longitude: 3.058,
        },
        descentRateMps: 2,
      }),
      fakeProvider(),
    ),
    { code: "TERRAIN_ALTITUDE_REQUIRED" },
  );
});

test("une cible égale au terrain ne crée aucune phase verticale inutile", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      targetAltitudeAmslM: 24,
      climbRateMps: 2,
      descentRateMps: 2,
    }),
    fakeProvider(),
  );
  assert.equal(result.mode, "constant-altitude");
  assert.equal(result.verticalProfile.climbDurationSeconds, 0);
  assert.equal(result.verticalProfile.descentDurationSeconds, 0);
  assert.ok(result.points.every((point) => point.altitudeAmslM === 24));
  assert.ok(
    result.points.slice(1).every((point) => point.verticalPhase === "level"),
  );
});

test("la traçabilité conserve phase, altitude météo et vent complet", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 40,
      targetAltitudeAmslM: 184,
      climbRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.equal(result.points[0].verticalPhase, "initial");
  assert.equal(result.points[0].windUsed, undefined);
  assert.equal(result.points[1].verticalPhase, "climb");
  assert.equal(result.points[1].windUsed.queryAltitudeAmslM, 64);
  assert.equal(result.points[1].windUsed.sourceModel, "arome_seamless");
  assert.equal(result.points[1].windUsed.sourceSlices.length, 1);
});

test("une seule préparation météo couvre des altitudes variables", async () => {
  let preparations = 0;
  let localCalls = 0;
  const provider = {
    async getWind(query) {
      throw new Error(`appel direct inattendu ${query.validAt}`);
    },
    async prepareProjection() {
      preparations += 1;
      return {
        async getWind(query) {
          localCalls += 1;
          return windSample(query);
        },
      };
    },
  };
  await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 120,
      targetAltitudeAmslM: 184,
      climbRateMps: 4,
      descentRateMps: 4,
    }),
    provider,
  );
  assert.equal(preparations, 1);
  assert.ok(localCalls > 1);
});

test("une altitude météo non encadrée échoue avec altitude et instant", async () => {
  await assert.rejects(
    projectConstantAltitudeTrajectory(
      validInput({
        durationSeconds: 100,
        targetAltitudeAmslM: 184,
        climbRateMps: 4,
      }),
      {
        async getWind(query) {
          if (query.altitudeAmslM > 100) {
            throw new TrajectoryDomainError(
              "ALTITUDE_NOT_BRACKETED",
              "Altitude non encadrée.",
            );
          }
          return windSample(query);
        },
      },
    ),
    (error) =>
      error.code === "ALTITUDE_NOT_BRACKETED" &&
      Number.isFinite(error.details.altitudeAmslM) &&
      typeof error.details.validAt === "string",
  );
});

test("aucun point ne dépasse la cible ni ne descend sous le terrain", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      durationSeconds: 101,
      targetAltitudeAmslM: 185,
      climbRateMps: 3,
      descentRateMps: 4,
    }),
    fakeProvider(),
  );
  assert.ok(
    result.points.every(
      (point) => point.altitudeAmslM >= 24 && point.altitudeAmslM <= 185,
    ),
  );
  assert.equal(result.points.at(-1).altitudeAmslM, 24);
  assert.equal(result.points.at(-1).timestamp, result.endedAt);
});

test("une altitude sous le terrain est refusée avant tout appel fournisseur", async () => {
  const provider = fakeProvider();
  await assert.rejects(
    projectConstantAltitudeTrajectory(
      validInput({ targetAltitudeAmslM: 10 }),
      provider,
    ),
    {
      code: "TARGET_BELOW_TERRAIN",
      message: "L’altitude cible est inférieure à l’altitude du terrain.",
    },
  );
  assert.equal(provider.queries.length, 0);
});

test("une altitude terrain inconnue autorise la projection constante", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({
      start: {
        name: "Terrain sans altitude",
        latitude: 50.631,
        longitude: 3.058,
      },
      targetAltitudeAmslM: 10,
    }),
    fakeProvider(),
  );
  assert.equal(result.points.length, 4);
});

test("les timestamps sont UTC et indépendants du fuseau local", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider(),
  );
  assert.equal(result.startedAt, "2026-07-27T04:00:00.000Z");
  assert.deepEqual(
    result.points.map((point) => point.timestamp),
    [
      "2026-07-27T04:00:00.000Z",
      "2026-07-27T04:00:20.000Z",
      "2026-07-27T04:00:40.000Z",
      "2026-07-27T04:01:00.000Z",
    ],
  );
});

test("une erreur fournisseur au premier pas rejette sans donnée factice", async () => {
  await assert.rejects(
    projectConstantAltitudeTrajectory(validInput(), fakeProvider(undefined, 1)),
    { code: "MISSING_WIND_DATA" },
  );
});

test("une erreur fournisseur en cours de calcul rejette le résultat complet", async () => {
  const provider = fakeProvider(undefined, 2);
  await assert.rejects(
    projectConstantAltitudeTrajectory(validInput(), provider),
    (error) =>
      error.code === "MISSING_WIND_DATA" &&
      error.details.stepIndex === 1 &&
      error.details.elapsedSeconds === 20,
  );
});

test("un pas personnalisé de 10 secondes est appliqué", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({ durationSeconds: 30 }),
    fakeProvider(),
    { stepSeconds: 10 },
  );
  assert.deepEqual(
    result.points.map((point) => point.elapsedSeconds),
    [0, 10, 20, 30],
  );
});

test("un pas nul, négatif ou non fini produit une erreur structurée", async () => {
  for (const stepSeconds of [0, -1, Number.NaN]) {
    await assert.rejects(
      projectConstantAltitudeTrajectory(
        validInput(),
        fakeProvider(),
        { stepSeconds },
      ),
      { code: "INVALID_STEP" },
    );
  }
});

test("chaque point après le premier conserve une trace compacte du vent", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput(),
    fakeProvider(),
  );
  assert.equal(result.points[0].windUsed, undefined);
  for (const point of result.points.slice(1)) {
    assert.equal(point.windUsed.speedMps, 5);
    assert.equal(point.windUsed.directionFromDeg, 270);
    assert.equal(point.windUsed.movementDirectionToDeg, 90);
    assert.equal(point.windUsed.sourceSlices[0].lowerLevel.pressureHpa, 1000);
    assert.equal(
      point.windUsed.sourceSlices[0].upperLevel.geopotentialHeightAmslM,
      500,
    );
  }
});

test("toutes les requêtes météo utilisent la colonne et les coordonnées du départ", async () => {
  const provider = fakeProvider();
  await projectConstantAltitudeTrajectory(validInput(), provider);
  assert.deepEqual(
    provider.queries.map(({ latitude, longitude }) => ({
      latitude,
      longitude,
    })),
    [
      { latitude: 50.631, longitude: 3.058 },
      { latitude: 50.631, longitude: 3.058 },
      { latitude: 50.631, longitude: 3.058 },
    ],
  );
});

test("le vent est échantillonné au début de chaque pas", async () => {
  const provider = fakeProvider();
  await projectConstantAltitudeTrajectory(validInput(), provider);
  assert.deepEqual(
    provider.queries.map((query) => query.validAt),
    [
      "2026-07-27T04:00:00.000Z",
      "2026-07-27T04:00:20.000Z",
      "2026-07-27T04:00:40.000Z",
    ],
  );
});

test("la date de fin vaut exactement départ plus durée", async () => {
  const result = await projectConstantAltitudeTrajectory(
    validInput({ durationSeconds: 3_601 }),
    fakeProvider(),
  );
  assert.equal(
    Date.parse(result.endedAt) - Date.parse(result.startedAt),
    3_601_000,
  );
  assert.equal(result.points.at(-1).timestamp, result.endedAt);
});

test("le moteur utilise une session préparée unique si le fournisseur la propose", async () => {
  let preparations = 0;
  let directCalls = 0;
  let localCalls = 0;
  const provider = {
    async getWind(query) {
      directCalls += 1;
      return windSample(query);
    },
    async prepareProjection() {
      preparations += 1;
      return {
        async getWind(query) {
          localCalls += 1;
          return windSample(query);
        },
      };
    },
  };
  await projectConstantAltitudeTrajectory(validInput(), provider);
  assert.equal(preparations, 1);
  assert.equal(directCalls, 0);
  assert.equal(localCalls, 3);
});

test("un vent inexploitable produit une erreur structurée", async () => {
  await assert.rejects(
    projectConstantAltitudeTrajectory(validInput(), {
      async getWind(query) {
        return windSample(query, {
          speedMps: Number.NaN,
          directionFromDeg: 270,
        });
      },
    }),
    { code: "INVALID_WIND" },
  );
});
