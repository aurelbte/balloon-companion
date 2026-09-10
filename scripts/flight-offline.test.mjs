import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import appManifest from "../app/manifest.ts";
import { buildFlightOffline, staticReferences } from "./build-flight-offline.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "flight-offline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    ".next/BUILD_ID": "build-A",
    ".next/prerender-manifest.json": JSON.stringify({ routes: { "/flight": { initialRevalidateSeconds: false } } }),
    ".next/server/app/flight.html": '<html><link href="/_next/static/chunks/style.css" rel="stylesheet"><script src="/_next/static/chunks/flight.js"></script>Static shell</html>',
    ".next/static/chunks/flight.js": 'load("static/chunks/lazy.js");',
    ".next/static/chunks/lazy.js": 'console.log("flight dependency");',
    ".next/static/chunks/style.css": '@font-face { src: url(../media/font.woff2); }',
    ".next/static/media/font.woff2": "font-bytes",
    ".next/static/chunks/journal-unrelated.js": "not flight",
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(resolve(root, name, ".."), { recursive: true });
    await writeFile(resolve(root, name), content);
  }
  const manifest = await buildFlightOffline(root);
  const resources = new Map();
  for (const item of [...manifest.assets, manifest.shell]) {
    resources.set(item.url, await readFile(resolve(root, item.url.startsWith("/_next/") ? ".next/" + item.url.slice(7) : "public/" + item.url.slice(1))));
  }
  return { root, manifest, resources, worker: await readFile(resolve(root, "public/flight-sw.js"), "utf8") };
}

function workerHarness(worker, resources, cachesData = new Map(), scope = "/") {
  const events = new Map(), fetched = [];
  const caches = {
    async open(name) {
      if (!cachesData.has(name)) cachesData.set(name, new Map());
      const data = cachesData.get(name);
      return { match: async key => data.get(key)?.clone(), put: async (key, value) => { data.set(key, value.clone()); }, delete: async key => data.delete(key) };
    },
    keys: async () => [...cachesData.keys()],
    delete: async name => cachesData.delete(name),
  };
  let offline = false;
  const self = { registration: { scope: "https://balloon.test" + scope }, location: { origin: "https://balloon.test" }, addEventListener: (event, handler) => events.set(event, handler), skipWaiting() { assert.fail("Must not force activation"); }, clients: { claim() { assert.fail("Must not switch an open document"); } } };
  runInContext(worker, createContext({ self, caches, crypto: webcrypto, Response, URL, Uint8Array, Set, fetch: async (url, options) => {
    fetched.push({ url, options });
    if (offline) throw new Error("offline");
    const bytes = resources.get(typeof url === "string" ? url : new URL(url.url).pathname);
    return new Response(bytes ?? "missing", { status: bytes ? 200 : 404 });
  } }));
  return {
    fetched, cachesData, offline: () => { offline = true; },
    async lifecycle(type) { let promise; events.get(type)({ waitUntil: value => { promise = value; } }); await promise; },
    request(path, { mode = "navigate", method = "GET", headers = {} } = {}) {
      let promise;
      events.get("fetch")({ request: { url: new URL(path, self.location.origin).href, mode, method, headers: new Headers(headers) }, respondWith: value => { promise = value; } });
      return promise;
    },
  };
}

test("build : shell statique + fermeture des dépendances JS/CSS/polices, sans autres routes", async t => {
  const { root, manifest } = await fixture(t);
  assert.deepEqual(manifest.assets.map(({ url }) => url), ["/_next/static/chunks/flight.js", "/_next/static/chunks/lazy.js", "/_next/static/chunks/style.css", "/_next/static/media/font.woff2"]);
  const before = manifest.version;
  await writeFile(resolve(root, ".next/static/chunks/lazy.js"), "new build content");
  assert.notEqual((await buildFlightOffline(root)).version, before);
  await writeFile(resolve(root, ".next/prerender-manifest.json"), '{"routes":{}}');
  await assert.rejects(buildFlightOffline(root), /static build-time page/);
  assert.deepEqual(staticReferences('url(https://tiles.test/tile.png) url(data:image/png;base64,abc)', '/_next/static/chunks/style.css'), []);
});

test("premier chargement connecté : /flight se recharge ensuite hors ligne avec toutes ses dépendances", async t => {
  const { worker, resources, manifest } = await fixture(t);
  const h = workerHarness(worker, resources);
  await h.lifecycle("install"); await h.lifecycle("activate"); h.offline();
  const response = await h.request("/flight?view=map");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Static shell/);
  for (const asset of manifest.assets) {
    assert.equal((await h.request(asset.url, { mode: "cors" })).status, 200);
  }
  assert.equal(h.fetched.length, manifest.assets.length + 1);
  assert.ok(h.fetched.every(({ options }) => options.credentials === "omit" && options.redirect === "error"));
});

test("aucune interception ni cache des données auth/API/RSC, météo, tuiles ou autres pages", async t => {
  const { worker, resources } = await fixture(t);
  const h = workerHarness(worker, resources); await h.lifecycle("install");
  for (const path of ["/journal", "/api/weather", "/auth/callback", "https://tile.openstreetmap.org/0/0/0.png", "/flight?_rsc=abc"]) {
    assert.equal(h.request(path), undefined);
  }
  assert.equal(h.request("/flight", { mode: "cors", headers: { RSC: "1" } }), undefined);
  assert.equal(h.request("/flight", { method: "POST" }), undefined);
  assert.equal(h.request("/flight", { mode: "cors" }), undefined);
});

test("installation incomplète ou fichier d'un autre build : rejet atomique, ancien cache conservé", async t => {
  const { worker, resources, manifest } = await fixture(t);
  for (const replacement of [undefined, Buffer.from("different build")]) {
    const broken = new Map(resources);
    if (replacement) broken.set(manifest.assets[0].url, replacement); else broken.delete(manifest.assets[0].url);
    const old = new Map([["balloon-flight-entry-root-old", new Map()], ["weather-cache", new Map()]]);
    const h = workerHarness(worker, broken, old);
    await assert.rejects(h.lifecycle("install"));
    assert.deepEqual([...old.keys()], ["balloon-flight-entry-root-old", "weather-cache"]);
  }
});

test("activation sans prise de contrôle forcée ; nettoyage limité aux anciens shells", async t => {
  const { worker, resources, manifest } = await fixture(t);
  const cachesData = new Map([["balloon-flight-entry-root-old", new Map()], ["weather-cache", new Map()]]);
  const h = workerHarness(worker, resources, cachesData);
  await h.lifecycle("install");
  assert.ok(cachesData.has("balloon-flight-entry-root-old"));
  await h.lifecycle("activate");
  assert.deepEqual([...cachesData.keys()].sort(), ["balloon-flight-entry-root-" + manifest.version, "weather-cache"].sort());
});

test("asset manquant après installation : pas de remplacement par le nouveau déploiement", async t => {
  const { worker, resources, manifest } = await fixture(t);
  const h = workerHarness(worker, resources); await h.lifecycle("install");
  h.cachesData.get("balloon-flight-entry-root-" + manifest.version).delete(manifest.assets[0].url);
  const before = h.fetched.length;
  assert.equal((await h.request(manifest.assets[0].url, { mode: "cors" })).status, 503);
  assert.equal(h.fetched.length, before);
});


test("icône PWA : start_url / ouvre le Cockpit en ligne sans le mettre en cache", async t => {
  assert.equal(appManifest().start_url, "/");
  const registration = await readFile(new URL("../app/components/FlightOfflineRegistration.tsx", import.meta.url), "utf8");
  assert.match(registration, /scope: "\/"/);
  const { worker, resources } = await fixture(t);
  resources.set("/", Buffer.from("Personalized online cockpit"));
  const h = workerHarness(worker, resources);
  await h.lifecycle("install"); await h.lifecycle("activate");
  const response = await h.request(appManifest().start_url);
  assert.equal(await response.text(), "Personalized online cockpit");
  assert.equal(h.fetched.at(-1).options.cache, "no-store");
  for (const cache of h.cachesData.values()) assert.equal(cache.has("/"), false);
});

test("icône PWA hors ligne : / redirige vers /flight puis sert la page déjà précachée", async t => {
  const { worker, resources } = await fixture(t);
  const h = workerHarness(worker, resources);
  await h.lifecycle("install"); await h.lifecycle("activate"); h.offline();
  const launch = await h.request(appManifest().start_url);
  assert.equal(launch.status, 302);
  assert.equal(launch.headers.get("cache-control"), "no-store");
  assert.equal(launch.headers.get("location"), "https://balloon.test/flight");
  const flight = await h.request(launch.headers.get("location"));
  assert.equal(flight.status, 200);
  assert.match(await flight.text(), /Static shell/);
});

test("migration de scope : le worker racine et l'ancien worker /flight ne suppriment pas leurs caches respectifs", async t => {
  const { worker, resources } = await fixture(t);
  const cachesData = new Map([["balloon-flight-shell-original", new Map()]]);
  const root = workerHarness(worker, resources, cachesData);
  await root.lifecycle("install"); await root.lifecycle("activate");
  const rootCache = [...cachesData.keys()].find(name => name.startsWith("balloon-flight-entry-root-"));
  const legacy = workerHarness(worker, resources, cachesData, "/flight");
  await legacy.lifecycle("install"); await legacy.lifecycle("activate");
  await root.lifecycle("activate");
  assert.ok(cachesData.has(rootCache));
  assert.ok(cachesData.has("balloon-flight-shell-original"));
  assert.ok([...cachesData.keys()].some(name => name.startsWith("balloon-flight-entry-legacy-")));
  root.offline(); legacy.offline();
  assert.equal((await root.request("/flight")).status, 200);
  assert.equal((await legacy.request("/flight")).status, 200);
});
