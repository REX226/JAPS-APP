/**
 * SENTINEL MONITOR (PURE PWA BACKEND)
 * 
 * 1. Checks for new alerts in Realtime DB.
 * 2. Sends "CRITICAL" Push Notifications (Bypasses Silent Mode where possible).
 * 3. Keeps the system alive.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
import http from 'http';

const admin = require("firebase-admin");
const fs = require("fs");

// --- CONFIGURATION ---
const MANUAL_DB_URL = process.env.DB_URL || "https://japs-parivar-siren-default-rtdb.firebaseio.com"; 
const SITE_URL = process.env.SITE_URL || "https://japs-parivar-siren.web.app";

console.log("\n========================================");
console.log("   🛡️  SENTINEL PWA MONITOR");
console.log("========================================");

// --- 1. SETUP CREDENTIALS ---
let serviceAccount;
const keyFileName = "service-account.json";
const envCreds = process.env.FIREBASE_SERVICE_ACCOUNT;

if (envCreds) {
    try {
        serviceAccount = JSON.parse(envCreds.trim());
    } catch (e) { console.error("Env Parse Error"); }
} else if (fs.existsSync(`./${keyFileName}`)) {
    serviceAccount = require(`./${keyFileName}`);
}

if (!serviceAccount) {
    console.error("❌ ERROR: No service-account.json found.");
    process.exit(1);
}

try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: MANUAL_DB_URL
    });
} catch (e) {
    console.error("Firebase Init Error:", e.message);
    process.exit(1);
}

const db = admin.database();
const messaging = admin.messaging();
const alertsRef = db.ref("/sentinel_alerts_v1");
const recurringRef = db.ref("/sentinel_recurring_v1");
const statusRef = db.ref("/sentinel_status/monitor");

const processedIds = new Set();
let nextPendingTime = null;

// --- 2. HTTP SERVER ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Sentinel Monitor Active");
}).listen(PORT, () => console.log(`🌐 Monitor listening on ${PORT}`));

// --- 3. STATUS UPDATE ---
function startHeartbeat() {
    const update = () => statusRef.update({ online: true, last_seen: Date.now() }).catch(()=>{});
    update();
    setInterval(update, 5000);
}

// --- 4. MASTER SCHEDULER ---
function startMasterScheduler() {
    console.log("⏰ Scheduler Active");

    setInterval(async () => {
        const now = Date.now();
        const dateObj = new Date();
        const currentTimeStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
        const currentSeconds = dateObj.getSeconds();

        // A. CHECK ONE-TIME ALERTS
        try {
            const snap = await alertsRef.once('value');
            const val = snap.val();
            if (val) {
                const alerts = Array.isArray(val) ? val : Object.values(val);
                for (const alert of alerts) {
                    const timeDiff = now - alert.scheduledTime;
                    // Check if due within last 15 mins
                    if (timeDiff >= 0 && timeDiff < 900000) {
                        if (!processedIds.has(alert.id)) {
                            console.log(`🔔 ALERT: ${alert.content}`);
                            processedIds.add(alert.id);
                            await sendNotifications(alert);
                        }
                    }
                }
            }
        } catch (e) {}

        // B. CHECK RECURRING ALERTS (First 10s of minute)
        if (currentSeconds < 10) { 
             try {
                const snap = await recurringRef.once('value');
                const val = snap.val();
                const rules = val ? (Array.isArray(val) ? val : Object.values(val)) : [];
                rules.forEach(async (rule) => {
                    const uid = `recurring-${rule.id}-${dateObj.getDate()}-${currentTimeStr}`;
                    if (rule.isActive && rule.scheduledTime === currentTimeStr) {
                         if (!processedIds.has(uid)) {
                            console.log(`🔄 RECURRING: ${rule.content}`);
                            processedIds.add(uid);
                            await sendNotifications({
                                id: uid,
                                severity: rule.severity,
                                content: `[DAILY] ${rule.content}`
                            });
                         }
                    }
                });
             } catch (e) {}
        }
    }, 2000);
}

// --- 5. NOTIFICATION SENDER (CRITICAL PRIORITY) ---
async function sendNotifications(alertData) {
    const snap = await db.ref("fcm_tokens").once("value");
    if (!snap.exists()) return;
    
    const tokens = [];
    snap.forEach(c => c.val().token && tokens.push(c.val().token));
    if (tokens.length === 0) return;

    const linkUrl = `${SITE_URL}/?emergency=true`;

    // 🚨 PAYLOAD CONSTRUCTION 🚨
    const payload = {
        // Data Payload (For Service Worker execution)
        data: {
            title: `🚨 ${alertData.severity} ALERT`,
            body: `${alertData.content}`,
            alertId: alertData.id,
            severity: alertData.severity,
            forceAlarm: "true",
            timestamp: Date.now().toString(),
            url: linkUrl
        },
        // Android Specifics
        android: {
            priority: "high", // Wakes device from Doze
            ttl: 0, // Deliver immediately
            notification: {
                priority: "max", // Heads-up display
                channelId: "sentinel_channel",
                defaultSound: true,
                visibility: "public",
                notificationCount: 1,
                clickAction: linkUrl
            }
        },
        // Web Push (Standard)
        webpush: {
            headers: {
                Urgency: "high" // RFC 8030 header
            },
            fcm_options: {
                link: linkUrl
            },
            notification: {
                requireInteraction: true,
                renotify: true,
                tag: "sentinel-alert"
            }
        }
    };

    try {
        const response = await messaging.sendEachForMulticast({ tokens: tokens, ...payload });
        console.log(`🚀 Sent to ${response.successCount} devices.`);
    } catch (e) {
        console.error("Error sending:", e);
    }
}

// Restart periodically to prevent memory leaks
setInterval(() => process.exit(0), 86400000);

startHeartbeat();
startMasterScheduler();