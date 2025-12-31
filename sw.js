
const CACHE_NAME = 'sentinel-v13'; // Bumped version to force immediate update for users
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './polling-worker.js',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install Event: Cache critical assets immediately
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force this new service worker to become active immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate Event: Clean up old caches (v12, v11, etc.)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(), // Take control of all open tabs immediately
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// Fetch Event: SMART CACHING STRATEGY
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // STRATEGY 1: Network First for HTML (Navigation & Index)
  // This ensures the user ALWAYS gets the latest version of the app if they have internet.
  const isHTML = event.request.mode === 'navigate' || 
                 url.pathname.endsWith('index.html') || 
                 url.pathname.endsWith('/');

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match('./index.html') || caches.match('./');
        })
    );
    return;
  }

  // STRATEGY 2: Stale-While-Revalidate for Static Assets (CSS, JS, Images)
  // Load from cache instantly for speed, but update the cache in the background for next time.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
        });
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    })
  );
});

// Handle notification clicks (iOS & Android)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const urlToOpen = new URL(self.location.origin).href + '?emergency=true';

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(function(clientList) {
      // 1. Try to find an existing window and focus it
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then((focusedClient) => {
             if (focusedClient && 'navigate' in focusedClient) {
                 return focusedClient.navigate(urlToOpen);
             }
             return focusedClient;
          });
        }
      }
      // 2. If no window exists, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
