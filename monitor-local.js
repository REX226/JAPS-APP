
/**
 * SENTINEL MONITOR (PRODUCTION)
 * 
 * 1. Checks for new alerts in Realtime DB.
 * 2. Sends "App Killed" Push Notifications.
 * 3. Sends Heartbeat to Admin Dashboard.
 * 4. Checks Recurring Rules every minute.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const admin = require("firebase-admin");
const fs = require("fs");

// --- CONFIGURATION ---
// 🔧 IF MONITOR SAYS "CONNECTED" BUT DASHBOARD SAYS "OFFLINE":
// 1. Go to Admin Dashboard -> Settings.
// 2. Copy the URL from there.
// 3. Paste it inside the quotes below:
const MANUAL_DB_URL = "https://japs-parivar-siren-default-rtdb.firebaseio.com"; 

// --- 1. SETUP CREDENTIALS ---
const keyFileName = "service-account.json";
const keyFileNamePlural = "service-accounts.json";
let serviceAccount;

// Smart File Detection
if (fs.existsSync(`./${keyFileName}`)) {
    console.log(`✅ FOUND KEY FILE: ${keyFileName}`);
    serviceAccount = require(`./${keyFileName}`);
} else if (fs.existsSync(`./${keyFileNamePlural}`)) {
    console.log(`⚠️  Found '${keyFileNamePlural}' instead of '${keyFileName}'. Using it anyway...`);
    serviceAccount = require(`./${keyFileNamePlural}`);
} else {
    console.error("\n❌ ERROR: Key file not found!");
    console.error(`   Expected: ./${keyFileName} OR ./${keyFileNamePlural}`);
    console.error("   1. Go to Firebase Console -> Project Settings -> Service Accounts");
    console.error("   2. Generate New Private Key");
    console.error("   3. Move it to this folder.");
    process.exit(1);
}

// Determine Database URL
const dbUrl = MANUAL_DB_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

console.log("\n========================================");
console.log("   🛡️  SENTINEL MONITOR STARTING");
console.log("========================================");
console.log(`✅ Project ID:  ${serviceAccount.project_id}`);
console.log(`🔗 Database:    ${dbUrl}`);
console.log("----------------------------------------");

try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: dbUrl
    });
} catch (e) {
    console.error("❌ Firebase Auth Error:", e.message);
    process.exit(1);
}

const db = admin.database();
const messaging = admin.messaging();
const alertsRef = db.ref("/sentinel_alerts_v1");
const recurringRef = db.ref("/sentinel_recurring_v1");
const statusRef = db.ref("/sentinel_status/monitor");

// --- 2. CONNECTION CHECK ---
db.ref(".info/connected").on("value", (snap) => {
    if (snap.val() === true) {
        console.log("🟢 Database Connected! Waiting for alerts...");
    } else {
        console.log("🟡 Connecting to Database...");
    }
});

// --- 3. HEARTBEAT SYSTEM ---
function startHeartbeat() {
    const updateStatus = () => {
        statusRef.update({
            online: true,
            last_seen: Date.now()
        }).catch(() => {});
    };

    updateStatus();
    // ✅ REDUCED TO 2 SECONDS
    setInterval(updateStatus, 2000);

    const onExit = () => {
        console.log("\n🛑 Stopping Monitor...");
        statusRef.update({ online: false }).then(() => process.exit(0));
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
}

// --- 4. STANDARD ALERT MONITORING ---
let lastProcessedId = null;

function startAlertListener() {
    alertsRef.limitToLast(1).once('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            const list = Array.isArray(val) ? val : Object.values(val);
            if (list.length > 0) lastProcessedId = list[list.length - 1].id;
        }
        
        alertsRef.on("value", async (change) => {
            const allAlerts = change.val();
            if (!allAlerts) return;

            const alertList = Array.isArray(allAlerts) ? allAlerts : Object.values(allAlerts);
            if (alertList.length === 0) return;

            const latestAlert = alertList[alertList.length - 1];

            if (latestAlert.id !== lastProcessedId) {
                console.log(`\n🔔 NEW ALERT: ${latestAlert.content}`);
                lastProcessedId = latestAlert.id;
                await sendNotifications(latestAlert);
            }
        });
    });
}

// --- 5. RECURRING ALERT SCHEDULER ---
let recurringRules = [];
let lastMinuteChecked = null;

function startRecurringScheduler() {
    recurringRef.on('value', (snap) => {
        const val = snap.val();
        recurringRules = val ? (Array.isArray(val) ? val : Object.values(val)) : [];
    });

    // ✅ REDUCED TO 2 SECONDS (Checks if minute changed more frequently)
    setInterval(() => {
        const now = new Date();
        const currentMinute = now.getMinutes();
        if (currentMinute === lastMinuteChecked) return;
        
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeStr = `${hours}:${minutes}`;

        recurringRules.forEach(async (rule) => {
            if (rule.isActive && rule.scheduledTime === currentTimeStr) {
                console.log(`\n🔄 RECURRING: ${rule.content}`);
                await sendNotifications({
                    id: `recurring-${rule.id}-${Date.now()}`,
                    severity: rule.severity,
                    content: `[DAILY] ${rule.content}`
                });
            }
        });
        lastMinuteChecked = currentMinute;
    }, 2000);
}

// --- 6. NOTIFICATION SENDER (HIGH PRIORITY) ---
async function sendNotifications(alertData) {
    const tokensSnapshot = await db.ref("fcm_tokens").once("value");
    if (!tokensSnapshot.exists()) return;

    const tokens = [];
    tokensSnapshot.forEach(child => {
        const t = child.val().token;
        if (t) tokens.push(t);
    });

    if (tokens.length === 0) return;

    // Payload designed to break through Doze mode
    const payload = {
        notification: {
            title: `🚨 ${alertData.severity} ALERT`,
            body: alertData.content,
        },
        data: {
            alertId: alertData.id,
            severity: alertData.severity,
            forceAlarm: "true",
            timestamp: Date.now().toString()
        },
        android: {
            priority: "high", // Wakes screen
            ttl: 0, // Deliver immediately
            notification: {
                priority: "max",
                channelId: "sentinel_channel_critical", // Uses system alert channel
                defaultSound: true,
                defaultVibrateTimings: true,
                visibility: "public"
            }
        },
        webpush: {
            headers: { 
                Urgency: "high"
            },
            notification: {
                requireInteraction: true,
                renotify: true,
                tag: `sentinel-alert-${Date.now()}`, // Unique tag forces new vibration
                silent: false
            }
        }
    };

    try {
        const response = await messaging.sendEachForMulticast({
            tokens: tokens,
            ...payload
        });
        console.log(`🚀 Sent to ${response.successCount} devices.`);
    } catch (e) {
        console.error("🔥 Error sending:", e);
    }
}

startHeartbeat();
startAlertListener();
startRecurringScheduler();
