import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

/** Follow only static resources referenced by the flight HTML and its chunks/CSS. */
export function staticReferences(text, from = "/flight") {
  const references = new Set();
  const decoded = text.replaceAll("\\/", "/");
  for (const match of decoded.matchAll(/(?:\/_next\/)?static\/(?:chunks|media)\/[^\s"'`<>\\?#]+?\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif)\b/g)) {
    references.add(match[0].startsWith("/_next/") ? match[0] : "/_next/" + match[0]);
  }
  if (from.endsWith(".css")) {
    for (const match of decoded.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
      const url = new URL(match[1], "https://offline.invalid" + from);
      if (url.origin === "https://offline.invalid" && url.pathname.startsWith("/_next/static/")) references.add(url.pathname);
    }
  }
  return [...references];
}

export async function buildFlightOffline(root = process.cwd()) {
  const buildRoot = resolve(root, ".next");
  const prerender = JSON.parse(await readFile(resolve(buildRoot, "prerender-manifest.json"), "utf8"));
  if (!prerender.routes["/flight"] || prerender.routes["/flight"].initialRevalidateSeconds !== false) {
    throw new Error("Offline /flight requires a static build-time page; never cache an authenticated response");
  }
  const html = await readFile(resolve(buildRoot, "server/app/flight.html"));
  const buildId = (await readFile(resolve(buildRoot, "BUILD_ID"), "utf8")).trim();
  const template = await readFile(new URL("./flight-offline-worker.js", import.meta.url), "utf8");
  const pending = staticReferences(html.toString());
  const assets = new Map();
  for (let i = 0; i < pending.length; i++) {
    const url = pending[i];
    if (assets.has(url)) continue;
    const path = resolve(buildRoot, "." + url.slice("/_next".length));
    if (!path.startsWith(resolve(buildRoot, "static") + "/")) throw new Error("Invalid offline resource path");
    const bytes = await readFile(path);
    assets.set(url, { url, sha256: hash(bytes) });
    if (/\.(js|css)$/.test(url)) pending.push(...staticReferences(bytes.toString(), url));
  }
  if (![...assets.keys()].some(url => url.endsWith(".js"))) throw new Error("No flight JavaScript found");
  const entries = [...assets.values()].sort((a, b) => a.url.localeCompare(b.url));
  const version = hash(buildId + hash(html) + JSON.stringify(entries) + template).slice(0, 24);
  const shell = { url: `/flight-offline/${version}/shell.html`, sha256: hash(html) };
  const manifest = { version, shell, assets: entries };
  const destination = resolve(root, "public", shell.url.slice(1));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
  await writeFile(resolve(root, "public/flight-sw.js"), template.replace("__FLIGHT_OFFLINE_MANIFEST__", JSON.stringify(manifest)));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildFlightOffline();
  console.log(`Offline /flight: ${manifest.assets.length} static resources, build ${manifest.version}`);
}
