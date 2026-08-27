import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addOrReuseFavoriteWeatherPlace, loadFavoriteWeatherPlaces, removeFavoriteWeatherPlace, renameFavoriteWeatherPlace, saveFavoriteWeatherPlaces, saveFavoriteWeatherPlacesWithDurableOutbox } from "./favoriteWeatherPlaces.ts";
import { loadFavoriteLaunchSites, saveFavoriteLaunchSites } from "./favoriteLaunchSites.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";

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

test("la création accepte un nom personnalisé puis le renommage conserve l’ID sans duplication", () => {
  const created = addOrReuseFavoriteWeatherPlace([], bailleul, "2026-08-18T08:00:00.000Z", "BC CLOUD TEST");
  assert.equal(created.selected.name, "BC CLOUD TEST");
  const renamed = renameFavoriteWeatherPlace(created.favorites, created.selected.id, "BC CLOUD TEST renommé", "2026-08-18T09:00:00.000Z");
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].id, created.selected.id);
  assert.equal(renamed[0].name, "BC CLOUD TEST renommé");
  assert.equal(renamed[0].createdAt, created.selected.createdAt);
  assert.equal(renamed[0].updatedAt, "2026-08-18T09:00:00.000Z");
});

test("la suppression retire uniquement le favori ciblé", () => {
  const first = addOrReuseFavoriteWeatherPlace([], bailleul, "2026-08-18T08:00:00.000Z").selected;
  const second = addOrReuseFavoriteWeatherPlace([first], { id: "osm-lille", name: "Lille", latitude: 50.63, longitude: 3.06 }, "2026-08-18T08:01:00.000Z").selected;
  assert.deepEqual(removeFavoriteWeatherPlace([first, second], first.id).map(({ id }) => id), [second.id]);
});

test("le rechargement USER conserve un renommage puis une suppression", () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("weather-edit") });
  const created = addOrReuseFavoriteWeatherPlace([], bailleul, "2026-08-18T08:00:00.000Z", "Maison").selected;
  saveFavoriteWeatherPlaces([created]);
  saveFavoriteWeatherPlaces(renameFavoriteWeatherPlace([created], created.id, "Terrain maison", "2026-08-18T09:00:00.000Z"));
  assert.deepEqual(loadFavoriteWeatherPlaces().map(({ id, name }) => ({ id, name })), [{ id: created.id, name: "Terrain maison" }]);
  saveFavoriteWeatherPlaces(removeFavoriteWeatherPlace(loadFavoriteWeatherPlaces(), created.id));
  assert.deepEqual(loadFavoriteWeatherPlaces(), []);
  delete globalThis.window;
});

test("le DELETE USER 103178767 est durable avant de finaliser la suppression", async () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("cloud-delete") });
  const favorite = addOrReuseFavoriteWeatherPlace([], { ...bailleul, id: "103178767" }, "2026-08-21T08:00:00.000Z", "BC CLOUD TEST").selected;
  saveFavoriteWeatherPlaces([favorite]);
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => "delete-mutation", now: () => "2026-08-21T09:00:00.000Z" } });
  const saved = await saveFavoriteWeatherPlacesWithDurableOutbox([], async (entityType, entityId, operation) => { await outbox.enqueue({ entityType, entityId, operation }); return true; });
  assert.equal(saved, true);
  assert.deepEqual(await outbox.list(), [{ mutationId: "delete-mutation", entityType: "favorite-weather-place", entityId: "103178767", operation: "DELETE", baseRevision: 0, createdAt: "2026-08-21T09:00:00.000Z", attempts: 0 }]);
  assert.deepEqual(loadFavoriteWeatherPlaces(), []);
  delete globalThis.window;
});

test("un échec d’enqueue USER restaure le favori et GUEST reste local", async () => {
  const localStorage = storage();
  globalThis.window = { localStorage, dispatchEvent() {} };
  const favorite = addOrReuseFavoriteWeatherPlace([], { ...bailleul, id: "103178767" }, "2026-08-21T08:00:00.000Z", "BC CLOUD TEST").selected;
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: user("cloud-failure") });
  saveFavoriteWeatherPlaces([favorite]);
  assert.equal(await saveFavoriteWeatherPlacesWithDurableOutbox([], async () => false), false);
  assert.deepEqual(loadFavoriteWeatherPlaces().map(({ id }) => id), ["103178767"]);
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  saveFavoriteWeatherPlaces([favorite]);
  let guestEnqueueCalled = false;
  assert.equal(await saveFavoriteWeatherPlacesWithDurableOutbox([], async () => { guestEnqueueCalled = true; return false; }), true);
  assert.equal(guestEnqueueCalled, false);
  assert.deepEqual(loadFavoriteWeatherPlaces(), []);
  delete globalThis.window;
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
  const manager = readFileSync(new URL("../components/weather/WeatherFavoriteManager.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  assert.match(page, /setWeatherFavoriteManagerOpen\(true\)/);
  assert.match(page, /<WeatherFavoriteManager/);
  assert.match(page, /onAdd=\{\(place\) => preferences\.addFavoriteWeatherLocation\(place\)\}/);
  assert.match(manager, /Ajouter un favori/);
  assert.match(context, /addOrReuseFavoriteWeatherPlace\(favorites, site, new Date\(\)\.toISOString\(\), displayName\)/);
  assert.match(context, /favoriteWeatherLocationId: result\.selected\.id/);
  assert.match(context, /saveFavoriteWeatherPlaces\(result\.favorites\)/);
  assert.doesNotMatch(context, /FavoriteLaunchSite|loadFavoriteLaunchSites|saveFavoriteLaunchSites/);
  assert.match(context, /loadHourlyWeatherForecast\(\{ \.\.\.coordinates/);
});

test("l’UI gère renommer et supprimer avec confirmation via le pipeline existant", () => {
  const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../components/weather/WeatherFavoriteManager.tsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../contexts/WeatherPreferencesContext.tsx", import.meta.url), "utf8");
  assert.match(page, />Gérer<\/button>/);
  assert.doesNotMatch(page, /MoreHorizontal|FavoriteWeatherPlaceDialog|styles\.placePanel/);
  assert.match(page, /onRename=\{\(id, name\) => preferences\.renameFavoriteWeatherLocation\(id, name\)\}/);
  assert.match(page, /onRemove=\{\(id\) => preferences\.removeFavoriteWeatherLocation\(id\)\}/);
  assert.match(manager, /Gérer les favoris/);
  assert.match(manager, /latitude\.toFixed\(5\).*longitude\.toFixed\(5\)/s);
  assert.match(manager, /<Pencil size=\{15\} \/> Modifier/);
  assert.match(manager, /window\.confirm\(`Supprimer le favori/);
  assert.match(manager, /<Trash2 size=\{15\} \/> Supprimer/);
  assert.match(context, /renameFavoriteWeatherPlace\(favorites, id, name\)/);
  assert.match(context, /removeFavoriteWeatherPlace\(favorites, id\)/);
  assert.match(context, /await saveFavoriteWeatherPlacesWithDurableOutbox\(next\)/);
  assert.match(manager, /Suppression non enregistrée\. Réessayez\./);
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
  assert.match(dialog, /setSelectedPlace\(place\)/);
  assert.match(dialog, /onSelect\(\{ \.\.\.selectedPlace, name: displayName\.trim\(\) \}\)/);
});
