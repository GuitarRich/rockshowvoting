/**
 * Keeps the lyric book working on a stage with no signal.
 *
 * The pages, styles and scripts are fetched fresh whenever the network answers
 * within a few seconds, so a deploy shows up straight away, and the copy saved
 * here is the fallback. The set and the lyrics themselves are not cached here:
 * store.js keeps the last copy of each in localStorage, and the lyrics page
 * draws that when the API can't be reached. /api is never touched.
 */
const CACHE = "rs-shell-v2";
const SHELL = [
  "./lyrics.html", "./app.css", "./header.js", "./store.js", "./setlist.js", "./chords.js",
];
const WAIT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not stop the rest being saved.
    await Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const keepable = (res) => res && (res.ok || res.type === "opaque");

/** Network first, but give up after WAIT_MS and use the saved copy. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // Every show uses the same page, so each file is saved once, without its
  // ?show=: one copy that the newest load always replaces.
  const url = new URL(req.url);
  url.search = "";
  const key = url.toString();
  const net = fetch(req).then((res) => {
    if (keepable(res)) cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {});   // a late failure after the fallback is nobody's problem
  try {
    const res = await Promise.race([net, new Promise((r) => setTimeout(r, WAIT_MS))]);
    if (res) return res;
  } catch (err) { /* offline */ }
  const hit = await cache.match(key);
  return hit || net;   // nothing saved: wait for the network after all
}

/** Fonts never change at a given URL: saved copy first. */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (keepable(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    e.respondWith(networkFirst(req));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(cacheFirst(req));
  }
});
