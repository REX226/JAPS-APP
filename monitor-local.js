
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
// 🔧 IF THE MONITOR SAYS "CONNECTED" BUT ADMIN PANEL SAYS "OFFLINE":
// Paste your exact Database URL from the Admin Panel Settings here:
const MANUAL_DB_URL = "https://japs-parivar-siren-default-rtdb.firebaseio.co"; // e.g. "https://sentinel-123-default-rtdb.asia-southeast1.firebasedatabase.app"

// --- 1. SETUP CREDENTIALS ---
const keyFileName = "service-account.json";
const keyFileNamePlural = "service-accounts.json";
let serviceAccount;

// Smart File Detection
if (fs.existsSync(`./${keyFileName}`)) {
    serviceAccount = require(`./${keyFileName}`);
} else if (fs.existsSync(`./${keyFileNamePlural}`)) {
    console.log(`⚠️  Found '${keyFileNamePlural}' instead of '${keyFileName}'. Using it anyway...`);
    serviceAccount = require(`./${keyFileNamePlural}`);
} else {
    console.error("\n❌ ERROR: Key file not found!");
    console.error(`   Expected: ./${keyFileName}`);
    console.error("   1. Go to Firebase Console -> Project Settings -> Service Accounts");
    console.error("   2. Generate New Private Key");
    console.error("   3. Move it to this folder and rename it to 'service-account.json'");
    process.exit(1);
}

// Determine Database URL
// Priority: 1. Manual Override, 2. Constructed from Project ID
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
        }).catch((err) => {
            if (err.code === 'ENOTFOUND') {
                console.error("❌ Network Error: Cannot reach Firebase. Check internet.");
            } else if (err.code === 'PERMISSION_DENIED') {
                 console.error("❌ Permission Denied: Your service-account.json does not have permission to write to this DB.");
                 console.error("   Check if the 'project_id' in the json file matches the Database URL.");
            }
        });
    };

    updateStatus();
    setInterval(updateStatus, 5000);

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
    // Initial sync to find the last ID so we don't re-send old alerts
    alertsRef.limitToLast(1).once('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            const list = Array.isArray(val) ? val : Object.values(val);
            if (list.length > 0) lastProcessedId = list[list.length - 1].id;
        }
        
        // Listen for new ones
        alertsRef.on("value", async (change) => {
            const allAlerts = change.val();
            if (!allAlerts) return;

            const alertList = Array.isArray(allAlerts) ? allAlerts : Object.values(allAlerts);
            if (alertList.length === 0) return;

            const latestAlert = alertList[alertList.length - 1];

            if (latestAlert.id !== lastProcessedId) {
                console.log(`\n🔔 NEW ALERT DETECTED: [${latestAlert.severity}]`);
                console.log(`   "${latestAlert.content}"`);
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
    // Keep local rules synced
    recurringRef.on('value', (snap) => {
        const val = snap.val();
        recurringRules = val ? (Array.isArray(val) ? val : Object.values(val)) : [];
    });

    // Check every 10 seconds (to hit the minute mark accurately)
    setInterval(() => {
        const now = new Date();
        const currentMinute = now.getMinutes();
        
        // Only trigger once per minute
        if (currentMinute === lastMinuteChecked) return;
        
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeStr = `${hours}:${minutes}`;

        recurringRules.forEach(async (rule) => {
            if (rule.isActive && rule.scheduledTime === currentTimeStr) {
                console.log(`\n🔄 RECURRING TRIGGER: ${rule.content}`);
                
                // Create a temporary alert object for the push payload
                const alertPayload = {
                    id: `recurring-${rule.id}-${Date.now()}`,
                    severity: rule.severity,
                    content: `[DAILY] ${rule.content}`
                };
                
                await sendNotifications(alertPayload);
            }
        });

        lastMinuteChecked = currentMinute;
    }, 10000);
}

// --- 6. NOTIFICATION SENDER ---
async function sendNotifications(alertData) {
    const tokensSnapshot = await db.ref("fcm_tokens").once("value");
    if (!tokensSnapshot.exists()) {
        console.log("⚠️  Skipping push: No devices registered yet.");
        return;
    }

    const tokens = [];
    tokensSnapshot.forEach(child => {
        const t = child.val().token;
        if (t) tokens.push(t);
    });

    console.log(`🚀 Sending Push to ${tokens.length} devices...`);

    // HIGH PRIORITY PAYLOAD TO WAKE UP SCREEN
    const payload = {
        notification: {
            title: `🚨 ${alertData.severity} ALERT`,
            body: alertData.content,
        },
        data: {
            alertId: alertData.id,
            severity: alertData.severity,
            forceAlarm: "true",
            url: "https://sentinel-alert.netlify.app/", 
            timestamp: Date.now().toString()
        },
        // Android specific: High Priority to wake screen and show on lockscreen
        android: {
            priority: "high", 
            ttl: 0, // Deliver immediately or fail
            notification: {
                priority: "max", // Heads-up notification (popup)
                channelId: "sentinel_channel_critical",
                visibility: "public", // Show content on lock screen
                defaultSound: true,
                defaultVibrateTimings: true,
                icon: "stock_ticker_update" 
            }
        },
        // Web Push: Standard headers
        webpush: {
            headers: { 
                Urgency: "high",
                TTL: "0" 
            },
            notification: {
                silent: false,
                requireInteraction: true, // Notification stays until user clicks
                renotify: true, // Vibrate/Sound even if previous notif exists
                tag: "sentinel-alert",
                vibrate: [500, 200, 500, 200, 1000, 500, 200, 500] 
            }
        }
    };

    try {
        const response = await messaging.sendEachForMulticast({
            tokens: tokens,
            ...payload
        });
        console.log(`✅ Result: ${response.successCount} sent, ${response.failureCount} failed.`);
    } catch (e) {
        console.error("🔥 Error sending:", e);
    }
}

// --- STARTUP ---
startHeartbeat();
startAlertListener();
startRecurringScheduler();
