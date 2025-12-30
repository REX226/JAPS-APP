
// Service Worker for handling background notifications
// Using compat libraries for broader support
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// -----------------------------------------------------------
// 🔧 CONFIGURATION REQUIRED (MUST MATCH src/services/firebase.ts)
// -----------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBzBlEr1WSMy5ornhdEvEmLvg_9oKsYqDU",
  authDomain: "japs-parivar-siren.firebaseapp.com",
  databaseURL: "https://japs-parivar-siren-default-rtdb.firebaseio.com",
  projectId: "japs-parivar-siren",
  storageBucket: "japs-parivar-siren.firebasestorage.app",
  messagingSenderId: "329214308072",
  appId: "1:329214308072:web:7dfb90b6629e84f590235d",
  measurementId: "G-18MNV84E8X"
};

// Force immediate activation
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

try {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Background Message Handler
  messaging.onBackgroundMessage(function(payload) {
    console.log('[SW] Received background message ', payload);
    
    const title = payload.notification?.title || '🚨 SENTINEL ALERT';
    const body = payload.notification?.body || 'Emergency Broadcast Received';
    const timestamp = Date.now();
    
    // 🔊 EXTREME VIBRATION PATTERN (Simulates a siren rhythm)
    // 1000ms vibe, 200ms pause, repeat...
    const vibrationPattern = [
        1000, 200, 1000, 200, 1000, 200, 
        2000, 500, 2000, 500, 
        1000, 200, 1000, 200
    ];

    const notificationOptions = {
      body: body,
      icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      tag: 'sentinel-alert-' + timestamp, 
      renotify: true,           
      requireInteraction: true, // Won't go away until clicked
      silent: false,           
      // ⚠️ IMPORTANT: Explicitly requesting default sound to ring phone
      sound: 'default', 
      vibrate: vibrationPattern,
      data: {
        url: self.location.origin + '?emergency=true', 
        timestamp: timestamp
      }
    };

    return self.registration.showNotification(title, notificationOptions);
  });
} catch(e) {
  console.error("Firebase SW Init Error", e);
}

// Click Handler
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  // Construct the URL to open (with the emergency flag)
  const urlToOpen = new URL(self.location.origin).href + '?emergency=true';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // 1. Try to find an existing window
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('/') && 'focus' in client) {
            // Focus and navigate
            return client.focus().then(c => {
               if(c && c.navigate) return c.navigate(urlToOpen);
               return c;
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
