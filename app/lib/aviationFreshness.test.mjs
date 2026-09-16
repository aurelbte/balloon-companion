import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AVIATION_REFRESH_MS, aviationFreshness, retainStaleAviation } from "./aviation/aviationFreshness.ts";
import { startCockpitAviationRefresh } from "./aviation/cockpitAviationRefresh.ts";
import { qnhHpaFromMetar } from "../weather/aviationPresentation.ts";

const now = Date.parse("2026-09-16T12:05:00Z");
const weather = (changes = {}) => ({
  airport: "LFQO", status: "AVAILABLE",
  metarRaw: "LFQO 161200Z 24008KT CAVOK 20/10 Q1015",
  tafRaw: "TAF LFQO 161100Z 1612/1712 24008KT CAVOK",
  metarIssuedAt: "2026-09-16T12:00:00Z", tafIssuedAt: "2026-09-16T11:00:00Z",
  sourceUpdatedAt: "2026-09-16T12:05:00Z", ...changes,
});

test("METAR récent : émission, âge et récupération explicitement affichés", () => {
  const freshness = aviationFreshness(weather(), "metar", now);
  assert.equal(freshness.usable, true);
  assert.match(freshness.label, /Émis le 2026-09-16 12:00 UTC · âge 5 min/);
  assert.match(freshness.label, /récupéré le 2026-09-16 12:05 UTC/);
});

test("un METAR fraîchement récupéré reste périmé dès 90 minutes d'âge", () => {
  const data = weather({ metarIssuedAt: "2026-09-16T10:35:00Z" });
  assert.equal(aviationFreshness(data, "metar", now - 1).usable, true);
  const freshness = aviationFreshness(data, "metar", now);
  assert.equal(freshness.usable, false);
  assert.match(freshness.label, /METAR périmé/);
});

test("STALE interdit le QNH courant même avec une émission récente", () => {
  const data = weather({ status: "STALE" });
  const freshness = aviationFreshness(data, "metar", now);
  assert.equal(freshness.usable, false);
  assert.match(freshness.label, /ancienne\/périmée.*actualisation échouée/);
  assert.equal(qnhHpaFromMetar(data.metarRaw), 1015); // dernière valeur conservable
  assert.equal(freshness.usable ? qnhHpaFromMetar(data.metarRaw) : null, null);
  assert.equal(aviationFreshness(data, "taf", now).usable, false);
});

test("la récupération expire après 15 minutes sans changer les données", () => {
  const data = weather();
  assert.equal(aviationFreshness(data, "metar", now + 15 * 60_000 - 1).usable, true);
  assert.equal(aviationFreshness(data, "metar", now + 15 * 60_000).usable, false);
  assert.equal(data.status, "AVAILABLE");
});

test("une émission absente, invalide ou future n'est pas fiable", () => {
  for (const metarIssuedAt of [null, "invalid", "2026-09-16T13:00:00Z"]) {
    assert.equal(aviationFreshness(weather({ metarIssuedAt }), "metar", now).usable, false);
  }
  assert.equal(aviationFreshness(weather({ metarRaw: null }), "metar", now).usable, false);
  assert.equal(aviationFreshness(weather({ sourceUpdatedAt: "invalid" }), "metar", now).usable, false);
});

test("TAF : validité pertinente plutôt qu'un seuil METAR de 90 minutes", () => {
  assert.equal(aviationFreshness(weather({ tafIssuedAt: "2026-09-16T06:00:00Z" }), "taf", now).usable, true);
  assert.match(aviationFreshness(weather(), "taf", now).label, /âge 65 min/);
  const end = Date.parse("2026-09-17T12:00:00Z");
  const data = weather({ sourceUpdatedAt: new Date(end).toISOString() });
  assert.equal(aviationFreshness(data, "taf", end - 1).usable, true);
  assert.match(aviationFreshness(data, "taf", end).label, /TAF périmé/);
  assert.match(aviationFreshness(weather({ tafRaw: "TAF LFQO 161100Z 1618/1718 CAVOK" }), "taf", now).label, /pas encore valide/);
});

test("TAF : passage de mois, d'année et heure 24 UTC", () => {
  for (const [issued, raw, instant] of [
    ["2026-09-30T23:00:00Z", "TAF LFQO 302300Z 0100/0200 CAVOK", "2026-10-01T01:00:00Z"],
    ["2026-12-31T23:00:00Z", "TAF LFQO 312300Z 0100/0200 CAVOK", "2027-01-01T01:00:00Z"],
    ["2026-09-16T11:00:00Z", "TAF LFQO 161100Z 1612/1624 CAVOK", "2026-09-16T23:59:00Z"],
  ]) {
    const data = weather({ tafIssuedAt: issued, tafRaw: raw, sourceUpdatedAt: instant });
    assert.equal(aviationFreshness(data, "taf", Date.parse(instant)).usable, true, raw);
  }
});

test("TAF annulé, sans validité ou avec un jour impossible : avertissement", () => {
  for (const tafRaw of ["TAF LFQO 161100Z 1612/1712 CNL", "TAF LFQO 161100Z NIL", "TAF LFQO 161100Z CAVOK", "TAF LFQO 161100Z 0012/1712 CAVOK"]) {
    assert.equal(aviationFreshness(weather({ tafRaw }), "taf", now).usable, false);
  }
});

test("échec réseau : conserve sans rajeunir ni mélanger les aérodromes ; récupération", () => {
  const data = weather();
  const retained = retainStaleAviation(data, "LFQO");
  assert.equal(retained.status, "STALE");
  assert.equal(retained.sourceUpdatedAt, data.sourceUpdatedAt);
  assert.equal(retained.metarIssuedAt, data.metarIssuedAt);
  assert.equal(data.status, "AVAILABLE");
  assert.equal(retainStaleAviation(data, "EBKT"), null);
  assert.equal(retainStaleAviation(null, "LFQO"), null);
  assert.equal(aviationFreshness(retained, "metar", now).usable, false);
  assert.equal(aviationFreshness(weather(), "metar", now).usable, true);
});

function browser(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const window = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  let cleanup = () => {};
  t.after(() => {
    cleanup();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete globalThis.document;
  });
  return { window, document, setStop: (stop) => { cleanup = stop; } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("QNH : initial, toutes les 10 min, réseau/visibilité, âge chaque minute et nettoyage", async (t) => {
  const { window, document, setStop } = browser(t);
  const calls = [], results = [], clocks = [];
  const stop = startCockpitAviationRefresh("LFQO", { onResult: (r) => results.push(r), onFailure: () => assert.fail(), onClock: (time) => clocks.push(time) }, async (airport) => { calls.push(airport); return { data: weather(), error: null }; });
  setStop(stop);
  t.mock.timers.tick(0); await flush();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(60_000); await flush();
  assert.equal(calls.length, 1);
  assert.equal(clocks.at(-1), now + 60_000);
  t.mock.timers.tick(AVIATION_REFRESH_MS - 60_000); await flush();
  assert.equal(calls.length, 2);
  window.dispatchEvent(new Event("online")); await flush();
  assert.equal(calls.length, 3);
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange")); await flush();
  assert.equal(calls.length, 3);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange")); await flush();
  assert.equal(calls.length, 4);
  assert.equal(results.length, 4);
  stop();
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(AVIATION_REFRESH_MS); await flush();
  assert.equal(calls.length, 4);
});

test("QNH : pas de requêtes concurrentes, timeout puis nouvel essai", async (t) => {
  const { window, setStop } = browser(t);
  let calls = 0, failures = 0;
  const stop = startCockpitAviationRefresh("LFQO", { onResult: () => assert.fail(), onFailure: () => failures++, onClock: () => {} }, (_airport, signal) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  });
  setStop(stop);
  t.mock.timers.tick(0); await flush();
  window.dispatchEvent(new Event("online")); await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(20_000); await flush();
  assert.equal(failures, 1);
  window.dispatchEvent(new Event("online")); await flush();
  assert.equal(calls, 2);
  stop(); await flush();
  assert.equal(failures, 1); // annulation au démontage ignorée
});

test("QNH : une réponse tardive après démontage n'est pas publiée", async (t) => {
  browser(t);
  let resolve, resultCount = 0;
  const stop = startCockpitAviationRefresh("LFQO", { onResult: () => resultCount++, onFailure: () => assert.fail(), onClock: () => {} }, () => new Promise((done) => { resolve = done; }));
  t.mock.timers.tick(0); await flush();
  stop(); resolve({ data: weather(), error: null }); await flush();
  assert.equal(resultCount, 0);
});

test("UI : projection simulée inaccessible ; fraîcheur et QNH périmé branchés", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const menu = readFileSync(new URL("../components/flight/MapOptionsPopover.tsx", import.meta.url), "utf8");
  const geo = readFileSync(new URL("./geo.ts", import.meta.url), "utf8");
  const aviation = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  const instruments = readFileSync(new URL("../components/flight/FlightInstruments.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(menu, /weatherProjection|Projection météo/);
  assert.doesNotMatch(geo + page, /buildWeatherProjectionPoints/);
  assert.match(page, /showWeatherProjection=\{false\}/);
  assert.match(page, /qnhHpa = qnhFreshness\?\.usable \? lastQnhHpa : null/);
  assert.match(page, /startCockpitAviationRefresh\(airport/);
  assert.match(aviation, /metarFreshness\.label/);
  assert.match(aviation, /tafFreshness\.label/);
  assert.doesNotMatch(aviation, />Valide <strong>/);
  assert.match(instruments, /Ancien QNH/);
});
