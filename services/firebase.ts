import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// 1. Firebase Configuration
// GO TO: Firebase Console > Project Settings > General > Your apps > SDK Setup and Configuration
// COPY the values from there and PASTE them below.
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

// Initialize only if we have a valid API Key (prevents errors during initial setup)
const isConfigured = firebaseConfig.apiKey !== "AIzaSyBzBlEr1WSMy5ornhdEvEmLvg_9oKsYqDU";

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;
const messaging = app ? getMessaging(app) : null;

export const initializePushNotifications = async () => {
  if (!messaging || !db) {
    console.warn("Firebase not configured. Notifications disabled.");
    return;
  }

  try {
    // 1. Request Permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // 2. Get Device Token
    const token = await getToken(messaging, { 
      // Optional: Add vapidKey here if you generated one in Cloud Messaging settings
    });

    if (token) {
      console.log("FCM Token:", token);
      saveTokenToDatabase(token);
    }
    
    // 3. Handle Foreground Messages
    onMessage(messaging, (payload) => {
      console.log('Foreground Message:', payload);
      // We rely on polling-worker for UI updates, but this ensures connectivity
    });

  } catch (error) {
    console.error("Error setting up notifications:", error);
  }
};

const saveTokenToDatabase = async (token: string) => {
  if (!db) return;
  // Use a sanitized token as the key to prevent duplicates
  const tokenKey = token.substring(0, 20) + "..." + token.substring(token.length - 5);
  
  // Store in database
  await set(ref(db, `fcm_tokens/${token.replace(/[.\#$\[\]]/g, "_")}`), {
    token: token,
    lastSeen: Date.now(),
    deviceInfo: navigator.userAgent
  });
};