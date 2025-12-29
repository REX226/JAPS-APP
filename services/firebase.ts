
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken } from "firebase/messaging";

// -----------------------------------------------------------
// ✅ ACTIVE CONFIGURATION FILE
// -----------------------------------------------------------
// 🔧 INSTRUCTIONS
// 1. Go to Firebase Console -> Project Settings
// 2. Scroll down to "SDK Setup and Configuration"
// 3. Copy the 'firebaseConfig' object keys and paste below.
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

// Check if configured
const isConfigured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE";

if (!isConfigured) {
    // Console log disabled to keep clean
} else {
    console.warn("⚠️ Firebase is NOT configured. Push notifications will not work.");
}

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;
const messaging = app ? getMessaging(app) : null;

// --- EXPORTS ---
export const checkFirebaseConfig = () => {
    return isConfigured;
};

export const initializePushNotifications = async () => {
  if (!messaging || !db) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.log("❌ Notification permission denied");
        return false;
    }

    // Get FCM Token
    const token = await getToken(messaging, { 
      // If you have a VAPID key, add it here: vapidKey: "..."
    });

    if (token) {
      console.log("✅ FCM Token Generated:", token);
      await saveTokenToDatabase(token);
      return true;
    }
    return false;

  } catch (error) {
    console.error("Error initializing notifications:", error);
    return false;
  }
};

const saveTokenToDatabase = async (token: string) => {
  if (!db) return;
  
  // Create a safe key for the database
  const safeKey = token.substring(0, 10) + "..." + token.substring(token.length - 5);
  
  // Save token with metadata
  try {
      await set(ref(db, `fcm_tokens/${token.replace(/[.\#$\[\]]/g, "_")}`), {
        token: token,
        updatedAt: Date.now(),
        userAgent: navigator.userAgent
      });
      console.log("✅ Token saved to Realtime Database");
  } catch(e) {
      console.error("❌ Failed to save token to DB:", e);
  }
};
