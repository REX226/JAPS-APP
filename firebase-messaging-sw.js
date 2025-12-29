
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
    
    // 🔊 AGGRESSIVE VIBRATION PATTERN
    const vibrationPattern = [
        500, 200, 500, 200, 500, 200, // SOS
        1000, 500, 1000, 500, 1000 // Long buzzes
    ];

    const notificationOptions = {
      body: body,
      icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      tag: 'sentinel-alert-' + timestamp, // Unique tag forces new alert
      renotify: true,           
      requireInteraction: true, 
      silent: false,            
      vibrate: vibrationPattern,
      data: {
        url: self.location.origin,
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
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
