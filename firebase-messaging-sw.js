
// Service Worker for handling background notifications
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// -----------------------------------------------------------
// 🔧 CONFIGURATION REQUIRED
// Use the SAME config as in services/firebase.ts
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

if (firebaseConfig.apiKey !== "AIzaSyBzBlEr1WSMy5ornhdEvEmLvg_9oKsYqDU") {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Background Message Handler
  messaging.onBackgroundMessage(function(payload) {
    console.log('[SW] Received background message ', payload);
    
    const title = payload.notification?.title || '🚨 SENTINEL ALERT';
    const body = payload.notification?.body || 'Emergency Broadcast Received';
    
    // Aggressive vibration for attention (SOS pattern)
    // 3 short, 3 long, 3 short
    const vibrationPattern = [
        200, 100, 200, 100, 200, 100, 
        500, 100, 500, 100, 500, 100, 
        200, 100, 200, 100, 200
    ];

    const notificationOptions = {
      body: body,
      icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
      tag: 'sentinel-alert',
      renotify: true,         // Alert again even if one exists
      requireInteraction: true, // Keep notification on screen until user clicks
      silent: false,          // Ensure sound plays (system default)
      vibrate: vibrationPattern,
      data: {
        url: self.location.origin,
        timestamp: Date.now()
      }
    };

    return self.registration.showNotification(title, notificationOptions);
  });
}

// Click Handler: Open the app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If app is open, focus it
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open new window
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
