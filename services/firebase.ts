
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import { getMessaging, getToken } from "firebase/messaging";

// -----------------------------------------------------------
// ✅ ACTIVE CONFIGURATION FILE
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

// -----------------------------------------------------------
// 🔑 VAPID KEY (Web Push Certificate)
// -----------------------------------------------------------
const VAPID_KEY = "BD7XDu-yQd39uk_PPx1Xs_djDjWlQ1g3eTVAwohs4Ga4Jryk8FQ16Jhj2mLvL4P2KMpFNtLUdhwIk0yBzVxmCd8"; 

const isConfigured = firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE";

if (!isConfigured) {
    console.warn("⚠️ Firebase is NOT configured. Push notifications will not work.");
} else {
    console.log("✅ Firebase Configured");
}

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getDatabase(app) : null;
const messaging = app ? getMessaging(app) : null;

// --- EXPORTS ---
export const checkFirebaseConfig = () => {
    // Returns true only if BOTH the standard config AND the VAPID key are set
    return isConfigured && VAPID_KEY.length > 50;
};

export const initializePushNotifications = async () => {
  if (!messaging || !db) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.log("❌ Notification permission denied");
        return false;
    }

    // Get FCM Token with VAPID Key
    const token = await getToken(messaging, { 
      vapidKey: VAPID_KEY
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
