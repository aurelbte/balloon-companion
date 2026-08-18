import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addOrReuseFavoriteLaunchSite, loadFavoriteLaunchSites, saveFavoriteLaunchSites } from "./favoriteLaunchSites.ts";
import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";

const bailleul = { id: "osm-bailleul", name: "Bailleul, Nord, France", latitude: 50.7359, longitude: 2.7359 };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test("ajoute ou resélectionne un lieu sans doublon dans le registre Prépa", () => {
  const first = addOrReuseFavoriteLaunchSite([], bailleul, "2026-08-18T08:00:00.000Z");
  assert.equal(first.favorites.length, 1);
  assert.equal(first.selected.id, bailleul.id);
  assert.equal(first.selected.name, "Bailleul");
  const duplicateCoordinates = { ...bailleul, id: "autre-id", name: "Bailleul bis" };
  const second = addOrReuseFavoriteLaunchSite(first.favorites, duplicateCoordinates, "2026-08-18T09:00:00.000Z");
  assert.equal(second.favorites.length, 1);
  assert.equal(second.selected.id, bailleul.id);
});

test("le favori ajouté depuis Météo persiste dans le stockage partagé", () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "weather-pilot", email: "pilot@example.com", firstName: "", lastName: "" } });
  const result = addOrReuseFavoriteLaunchSite([], bailleul, "2026-08-18T08:00:00.000Z");
  assert.equal(saveFavoriteLaunchSites(result.favorites), true);
  assert.equal(loadFavoriteLaunchSites()[0]?.id, bailleul.id);
  delete globalThis.window;
});

test("le bouton Météo ouvre la recherche partagée et sélectionne immédiatement le résultat", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../components/weather/FavoriteWeatherPlaceDialog.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  const prepare = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-label="Ajouter un lieu météo" onClick=\{\(\) => setWeatherPlaceDialogOpen\(true\)\}/);
  assert.match(page, /preferences\.addFavoriteWeatherLocation\(place\)/);
  assert.match(page, /setWeatherPlaceDialogOpen\(false\)/);
  assert.match(dialog, /\/api\/geocoding\/search\?q=/);
  assert.match(dialog, /onCancel/);
  assert.match(context, /addOrReuseFavoriteLaunchSite\(favorites, site\)/);
  assert.match(context, /favoriteWeatherLocationId: result\.selected\.id/);
  assert.match(context, /loadHourlyWeatherForecast\(\{ \.\.\.coordinates/);
  assert.match(prepare, /loadFavoriteLaunchSites\(\)/);
  assert.match(prepare, /saveFavoriteLaunchSites\(next\)/);
});
