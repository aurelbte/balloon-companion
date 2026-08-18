import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addOrReuseFavoriteWeatherPlace, loadFavoriteWeatherPlaces, saveFavoriteWeatherPlaces } from "./favoriteWeatherPlaces.ts";
import { loadFavoriteLaunchSites, saveFavoriteLaunchSites } from "./favoriteLaunchSites.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

const user = (id) => ({ id, email: `${id}@example.com`, firstName: "", lastName: "" });
const bailleul = { id: "osm-bailleul", name: "Bailleul, Nord, France", latitude: 50.7359, longitude: 2.7359 };
const launchSite = { id: "launch-only", name: "Terrain Prépa", latitude: 50.8, longitude: 2.7, createdAt: "2026-08-18T08:00:00.000Z", updatedAt: "2026-08-18T08:00:00.000Z" };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

test("le registre Météo évite les doublons sans écrire dans Prépa", () => {
  const first = addOrReuseFavoriteWeatherPlace([], bailleul, "2026-08-18T08:00:00.000Z");
  assert.equal(first.favorites.length, 1);
  assert.equal(first.selected.name, "Bailleul");
  const second = addOrReuseFavoriteWeatherPlace(first.favorites, { ...bailleul, id: "autre-id" }, "2026-08-18T09:00:00.000Z");
  assert.equal(second.favorites.length, 1);
  assert.equal(second.selected.id, bailleul.id);
});

test("favoris Météo, favoris Prépa et scopes USER/GUEST restent indépendants", () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  const weatherA = addOrReuseFavoriteWeatherPlace([], bailleul, "2026-08-18T08:00:00.000Z");
  saveFavoriteWeatherPlaces(weatherA.favorites);
  assert.deepEqual(loadFavoriteLaunchSites(), []);
  saveFavoriteLaunchSites([launchSite]);
  assert.deepEqual(loadFavoriteWeatherPlaces().map(({ id }) => id), [bailleul.id]);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("B") });
  assert.deepEqual(loadFavoriteWeatherPlaces(), []);
  assert.deepEqual(loadFavoriteLaunchSites(), []);
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.deepEqual(loadFavoriteWeatherPlaces(), []);
  saveFavoriteWeatherPlaces(addOrReuseFavoriteWeatherPlace([], { ...bailleul, id: "guest-place" }).favorites);
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("A") });
  assert.deepEqual(loadFavoriteWeatherPlaces().map(({ id }) => id), [bailleul.id]);
  assert.deepEqual(loadFavoriteLaunchSites().map(({ id }) => id), [launchSite.id]);
  delete globalThis.window;
});

test("le bouton Météo crée et sélectionne dans le registre dédié", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  assert.match(page, /setWeatherPlaceDialogOpen\(true\)/);
  assert.match(page, /preferences\.addFavoriteWeatherLocation\(place\)/);
  assert.match(context, /addOrReuseFavoriteWeatherPlace\(favorites, site\)/);
  assert.match(context, /favoriteWeatherLocationId: result\.selected\.id/);
  assert.match(context, /saveFavoriteWeatherPlaces\(result\.favorites\)/);
  assert.doesNotMatch(context, /FavoriteLaunchSite|loadFavoriteLaunchSites|saveFavoriteLaunchSites/);
  assert.match(context, /loadHourlyWeatherForecast\(\{ \.\.\.coordinates/);
});

test("l’autocomplétion est temporisée, concurrent-safe et sans clic loupe", () => {
  const dialog = readFileSync(new URL("../components/weather/FavoriteWeatherPlaceDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /value\.length < 2/);
  assert.match(dialog, /window\.setTimeout\([\s\S]*350/);
  assert.match(dialog, /new AbortController\(\)/);
  assert.match(dialog, /active = false; controller\.abort\(\)/);
  assert.match(dialog, /fetch\(`\/api\/geocoding\/search\?q=/);
  assert.match(dialog, /searching \? "Recherche…"/);
  assert.match(dialog, /Aucun lieu trouvé/);
  assert.match(dialog, /La recherche de lieu est indisponible/);
  assert.match(dialog, /value=\{query\}/);
  assert.doesNotMatch(dialog, /onClick=\{\(\) => void search\(\)\}/);
  assert.match(dialog, /onClick=\{\(\) => onSelect\(place\)\}/);
});
