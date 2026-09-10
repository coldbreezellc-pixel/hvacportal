/* Penguin Maintenance service worker — app shell caching so the tracker opens with
 * no service. Data sync is handled by the app's IndexedDB outbox, not here.
 *
 * Strategy
 *   navigations       → network first, fall back to the cached page ("/")
 *   /_next/static/*   → cache first (hashed, immutable)
 *   icons/manifest    → stale-while-revalidate
 *   /api/* + Supabase → never intercepted
 */
const VERSION = "penguin-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = async (req, res) => {
  try { const c = await caches.open(VERSION); await c.put(req, res.clone()); } catch { /* quota */ }
  return res;
};

const networkFirst = async (req, fallbackUrl) => {
  try {
    const res = await fetch(req);
    if (res && res.ok) await put(req, res);
    return res;
  } catch {
    const cached = (await caches.match(req)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    return cached || new Response("<h1>Offline</h1><p>Open the app once while online so it can be cached.</p>", { status: 503, headers: { "Content-Type": "text/html" } });
  }
};

const cacheFirst = async (req) => {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) await put(req, res);
  return res;
};

const staleWhileRevalidate = async (req) => {
  const cached = await caches.match(req);
  const network = fetch(req).then((res) => (res && res.ok ? put(req, res) : res)).catch(() => null);
  return cached || (await network) || new Response("", { status: 504 });
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, images, etc.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (req.mode === "navigate") {
    // Every in-app route is the same client shell, so "/" is a safe fallback.
    event.respondWith(networkFirst(req, "/"));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (/\.(svg|png|ico|webmanifest|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(req));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
