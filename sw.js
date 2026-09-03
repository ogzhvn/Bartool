// Service Worker für Bartool.
//
// Wichtig beim Deployment: Die App liegt auf GitHub Pages in einem
// Unterverzeichnis (https://<user>.github.io/Bartool/). Deshalb sind hier
// ausschließlich relative Pfade erlaubt – ein führender "/" würde auf den
// Domain-Root zeigen und ins Leere laufen.
//
// Diese Versionsnummer bei JEDER Änderung an Frontend-Dateien hochzählen,
// sonst liefert der Cache alte Stände aus.
const CACHE = "bartool-v20";

// Der App-Shell: alles, was die Oberfläche zum Starten braucht.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/abv.js",
  "js/adminPanel.js",
  "js/allergens.js",
  "js/auditLog.js",
  "js/auth.js",
  "js/batching.js",
  "js/calculation.js",
  "js/changeRequests.js",
  "js/classicsData.js",
  "js/costing.js",
  "js/dataQuality.js",
  "js/dilution.js",
  "js/home.js",
  "js/houseRecipes.js",
  "js/ingredientEditor.js",
  "js/main.js",
  "js/menuCosting.js",
  "js/preparations.js",
  "js/printView.js",
  "js/productExport.js",
  "js/productLibrary.js",
  "js/products.js",
  "js/productsData.js",
  "js/quickSearch.js",
  "js/recipeExport.js",
  "js/recipeLibrary.js",
  "js/recipes.js",
  "js/storage.js",
  "js/supabaseClient.js",
  "js/supabaseConfig.js",
  "js/superjuice.js",
  "js/syrup.js",
  "js/tabs.js",
  "js/units.js",
  "js/utils.js",
];

// Fremd-Hosts, deren Dateien die App zum Funktionieren braucht (Libs, Icons,
// Schrift). Die werden zur Laufzeit gecacht, damit die App auch offline nicht
// an einem fehlenden CDN stirbt.
const CDN_HOSTS = [
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

// Dieselben Dateien wie die <script>/<link>-Tags in index.html. Sie werden
// mit-precacht, weil der Service Worker beim allerersten Seitenaufruf noch
// nicht aktiv ist – ohne das wäre die App erst ab dem zweiten Besuch
// vollständig offline nutzbar. Versionen exakt synchron zu index.html halten.
const CDN_PRECACHE = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Einzeln statt addAll: eine fehlende oder blockierte Datei darf nicht
      // die komplette Installation scheitern lassen. Die CDN-Dateien werden
      // zusätzlich zur Laufzeit nachgezogen (siehe staleWhileRevalidate).
      .then((cache) =>
        Promise.all([...PRECACHE, ...CDN_PRECACHE].map((url) => cache.add(url).catch(() => {})))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request)
      .then((response) => {
        if (response && response.ok && request.method === "GET") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => {
        // Offline und nicht im Cache: bei einem Seitenaufruf wenigstens die
        // App-Shell ausliefern, damit kein Browser-Fehler erscheint.
        if (request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Supabase niemals cachen: Auth-Tokens, Realtime und aktuelle Daten müssen
  // immer ans Netz. Ohne respondWith übernimmt der Browser wie gewohnt.
  if (url.hostname.endsWith("supabase.co")) return;
  if (request.method !== "GET") return;

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});
