const CACHE_NAME = 'timetable-v3';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
  'https://pub-55517176dab74910835fd4e839154e4e.r2.dev/woxora-ebook-images/woxora_logo_v1_e4lpaj.png'
];

// Install — cache core assets first, then try external ones individually
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Core assets must succeed
      await cache.addAll(CORE_ASSETS);

      // External assets — cache individually, don't fail if one breaks
      for (const url of EXTERNAL_ASSETS) {
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (e) {
          console.warn('SW: Could not cache external asset:', url, e);
        }
      }

      // Also try to cache Google Font files (woff2) by parsing the CSS
      try {
        const fontCssUrl = EXTERNAL_ASSETS[0];
        const cssResponse = await cache.match(fontCssUrl);
        if (cssResponse) {
          const cssText = await cssResponse.clone().text();
          const fontUrls = [...cssText.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
          for (const fontUrl of fontUrls) {
            try {
              const fontResp = await fetch(fontUrl);
              if (fontResp.ok) {
                await cache.put(fontUrl, fontResp);
              }
            } catch (e) {
              console.warn('SW: Could not cache font file:', fontUrl);
            }
          }
        }
      } catch (e) {
        console.warn('SW: Font file caching skipped:', e);
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first with network fallback
self.addEventListener('fetch', event => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        // Serve from cache, update in background (stale-while-revalidate)
        event.waitUntil(
          fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, networkResponse);
              });
            }
          }).catch(() => {})
        );
        return cachedResponse;
      }

      // Not cached — try network, then cache the result
      return fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone);
            })
          );
        }
        return networkResponse;
      }).catch(() => {
        // Offline and not cached — serve index.html for navigation
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
