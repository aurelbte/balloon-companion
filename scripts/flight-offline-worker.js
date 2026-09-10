/* Generated configuration contains only build artifacts, never session responses. */
const FLIGHT_OFFLINE = __FLIGHT_OFFLINE_MANIFEST__;
const CACHE_PREFIX = "balloon-flight-shell-";
const CACHE_NAME = CACHE_PREFIX + FLIGHT_OFFLINE.version;
const allowedAssets = new Set(FLIGHT_OFFLINE.assets.map(({ url }) => url));

async function checkedResponse(asset) {
  const response = await fetch(asset.url, { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!response.ok || response.type === "opaque") throw new Error("Offline artifact unavailable");
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== asset.sha256) throw new Error("Offline artifact belongs to a different build");
  return response;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Publish the shell last: a failed/partial download must never become usable.
      await cache.delete(FLIGHT_OFFLINE.shell.url);
      for (const asset of FLIGHT_OFFLINE.assets) {
        await cache.put(asset.url, await checkedResponse(asset));
      }
      const shell = await checkedResponse(FLIGHT_OFFLINE.shell);
      await cache.put(FLIGHT_OFFLINE.shell.url, new Response(await shell.arrayBuffer(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      }));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // No skipWaiting: an open flight keeps its current worker and complete build.
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    // No clients.claim: never switch an already loaded document to another build.
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Next RSC/prefetch payloads are not HTML documents and are never cached here.
  if (request.headers.has("RSC") || url.searchParams.has("_rsc")) return;
  const navigation = request.mode === "navigate" && (url.pathname === "/flight" || url.pathname === "/flight/");
  if (!navigation && !allowedAssets.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(navigation ? FLIGHT_OFFLINE.shell.url : url.pathname);
    // Never repair a missing old-build file with an unchecked new deployment.
    return response ?? new Response("Offline flight cache incomplete. Reconnect and reopen the application.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  })());
});
