const CACHE = "bartool-v3";

const APP_SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "js/adminPanel.js",
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
  "icons/icon-192.png",
  "icons/icon-512.png",
];

const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.hostname.includes("supabase.co")) {
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
