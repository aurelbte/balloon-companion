import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
const cockpitCard = readFileSync(new URL("../components/cockpit/ConditionsCard.tsx", import.meta.url), "utf8");

test("la carte météo ouvre la page dédiée", () => {
  assert.match(cockpitCard, /<Link[^>]+href=\{href\}/);
  assert.match(page, /href="\/"/);
});

test("Météo est sélectionné par défaut et Aviation reste indépendant", () => {
  assert.match(page, /useState<"weather" \| "aviation">\("weather"\)/);
  assert.match(page, /weatherPlace: null, aviationStation: null/);
});

test("les états vides météo, METAR et TAF sont prévus sans valeurs exemples", () => {
  assert.match(page, /Aucun lieu météo sélectionné/);
  assert.match(page, /Aucun aérodrome sélectionné/);
  assert.match(page, /METAR non disponible/);
  assert.match(page, /TAF non disponible/);
  assert.doesNotMatch(page, /LFQO|Lille|06:12|21:48/);
});

test("jour et heure ont des contrôles indépendants et une carte météo unique", () => {
  assert.match(page, /setSelectedDay/);
  assert.match(page, /setSelectedTime/);
  assert.match(page, /<Stepper label="Jour"/);
  assert.match(page, /<Stepper label="Heure"/);
  assert.match(page, /<SelectedWeatherCard slot=\{selectedSlot\}/);
  assert.doesNotMatch(page, /Heure par heure/);
});

test("la page consomme le service normalisé sans appeler Open-Meteo", () => {
  assert.match(page, /loadHourlyWeatherForecast/);
  assert.match(page, /WeatherHourlyPoint/);
  assert.doesNotMatch(page, /open-meteo\.com/);
});

test("le lieu, le chargement et l'erreur météo sont interactifs", () => {
  assert.match(page, /loadFavoriteLaunchSites/);
  assert.match(page, /preferences\.setFavoriteWeatherLocationId/);
  assert.match(page, /aria-pressed=\{favorite\.id === preferences\.favoriteWeatherLocationId\}/);
  assert.match(page, /Chargement des prévisions/);
  assert.match(page, /Prévisions indisponibles/);
  assert.match(page, /Réessayer/);
});

test("favoris et modèles utilisent des chips reliées au contexte global", () => {
  assert.match(page, /useWeatherPreferences/);
  assert.match(page, /preferences\.setWeatherModel/);
  assert.doesNotMatch(page, /<select/);
});

test("la navigation horaire traverse les frontières de journée", () => {
  assert.match(page, /offset > 0 \? adjacentTimes\[0\] : adjacentTimes\.at\(-1\)/);
  assert.match(page, /setSelectedDay\(adjacentDay\)/);
  assert.match(page, /previousTimeDisabled/);
  assert.match(page, /nextTimeDisabled/);
});

test("la grande carte utilise une hiérarchie unique sans encadrés internes", () => {
  assert.match(page, /WEATHER_LABELS\[slot\.weatherCode\]/);
  assert.match(page, /styles\.windFocus/);
  assert.match(page, /styles\.weatherSecondary/);
  assert.match(page, /Humidité/);
  assert.match(page, /Précipitations/);
  assert.match(page, /Couverture/);
  assert.match(page, /Visibilité/);
  assert.doesNotMatch(page, /const details =/);
});
