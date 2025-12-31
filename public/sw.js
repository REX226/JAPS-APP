
const CACHE_NAME = 'sentinel-v10'; // Version bumped
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './polling-worker.js',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install Event: Cache assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch Event: Serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
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
        // Check if the client matches our scope and is focusable
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus().then((focusedClient) => {
             // Navigate to emergency URL to trigger siren logic if needed
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
