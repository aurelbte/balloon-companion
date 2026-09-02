import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("les recherches utilisateur demandent le clavier et l'action de recherche", () => {
  const sources = [
    read("../components/prepare/TerrainSelector.tsx"),
    read("../components/weather/FavoriteWeatherPlaceDialog.tsx"),
    read("../components/weather/WeatherFavoriteManager.tsx"),
    read("../weather/page.tsx"),
    read("../components/journal/AscensionLog.tsx"),
    read("../components/journal/JournalFlightList.tsx"),
    read("../more/friends/page.tsx"),
  ];
  for (const source of sources) {
    assert.match(source, /type="search"/);
    assert.match(source, /enterKeyHint="search"/);
  }
});

test("les identifiants techniques désactivent correction et orthographe", () => {
  const balloon = read("../components/balloons/BalloonForm.tsx");
  const ascension = read("../components/journal/OfficialAscensionForm.tsx");
  const profile = read("../more/profile/experience/page.tsx");
  const friends = read("../more/friends/page.tsx");
  for (const source of [balloon, ascension, profile, friends]) {
    assert.match(source, /autoCorrect="off"/);
    assert.match(source, /spellCheck=\{false\}/);
  }
  assert.match(balloon, /autoCapitalize="characters"/);
  assert.match(ascension, /Immatriculation[\s\S]*?autoCapitalize="characters"/);
  assert.match(friends, /autoCapitalize="none"[\s\S]*?enterKeyHint="done"/);
});

test("les saisies numériques et décimales conservent leurs contrats", () => {
  const prepare = read("../prepare/page.tsx");
  const balloon = read("../components/balloons/BalloonForm.tsx");
  const ascension = read("../components/journal/OfficialAscensionForm.tsx");
  assert.match(prepare, /inputMode="numeric"/);
  assert.match(prepare, /event\.target\.value\.replace\(\/\\D\/g, ""\)/);
  assert.match(balloon, /inputMode="decimal"/);
  assert.match(balloon, /decimalInput\(e\.target\.value\)/);
  assert.match(ascension, /type="number" min="0" step="1" inputMode="numeric"/);
});
