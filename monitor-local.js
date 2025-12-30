
/**
 * SENTINEL MONITOR (PRODUCTION)
 * 
 * 1. Checks for new alerts in Realtime DB.
 * 2. Sends "App Killed" Push Notifications.
 * 3. Sends Heartbeat to Admin Dashboard.
 * 4. Checks Recurring Rules every minute.
 * 5. Checks Scheduled One-Time Alerts.
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

// Track IDs we have already pushed to avoid duplicate spamming
const processedIds = new Set();

// --- 2. CONNECTION CHECK ---
db.ref(".info/connected").on("value", (snap) => {
    if (snap.val() === true) {
        console.log("🟢 Database Connected! Monitoring timeline...");
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
    setInterval(updateStatus, 2000);

    const onExit = () => {
        console.log("\n🛑 Stopping Monitor...");
        statusRef.update({ online: false }).then(() => process.exit(0));
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
}

// --- 4. MASTER SCHEDULER (CHECKS EVERYTHING) ---
// This replaces the old separate listeners to ensure we handle future dates correctly.

function startMasterScheduler() {
    console.log("⏰ Scheduler Active: Checking for alerts every 1 second...");

    // UPDATED: Check every 1000ms (1 second) instead of 2000ms
    setInterval(async () => {
        const now = Date.now();
        const dateObj = new Date();
        const currentTimeStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
        const currentSeconds = dateObj.getSeconds();

        // A. CHECK STANDARD ALERTS (One-Time)
        try {
            const snapshot = await alertsRef.once('value');
            const val = snapshot.val();
            
            if (val) {
                const allAlerts = Array.isArray(val) ? val : Object.values(val);
                
                for (const alert of allAlerts) {
                    // Logic:
                    // 1. Alert Scheduled Time has passed or is now.
                    // 2. Alert is not older than 1 minute (prevents spamming old alerts on restart).
                    // 3. We haven't processed it in this session yet.
                    
                    const timeDiff = now - alert.scheduledTime;
                    
                    if (timeDiff >= 0 && timeDiff < 60000) {
                        if (!processedIds.has(alert.id)) {
                            console.log(`\n🔔 SCHEDULED ALERT DUE: ${alert.content}`);
                            processedIds.add(alert.id);
                            await sendNotifications(alert);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Read Error:", e.message);
        }

        // B. CHECK RECURRING ALERTS (Every minute at 00 seconds)
        // We check if we are in the first 5 seconds of the minute to ensure we hit it.
        // With 1s interval, this will check roughly 5 times, but 'processedIds' prevents dupes.
        if (currentSeconds < 5) {
             try {
                const snap = await recurringRef.once('value');
                const val = snap.val();
                const rules = val ? (Array.isArray(val) ? val : Object.values(val)) : [];

                rules.forEach(async (rule) => {
                    // Create a unique ID for today's occurrence to prevent duplicate firing in the same minute
                    const uniqueId = `recurring-${rule.id}-${dateObj.getDate()}-${currentTimeStr}`;

                    if (rule.isActive && rule.scheduledTime === currentTimeStr) {
                         if (!processedIds.has(uniqueId)) {
                            console.log(`\n🔄 RECURRING DUE: ${rule.content}`);
                            processedIds.add(uniqueId);
                            
                            await sendNotifications({
                                id: uniqueId,
                                severity: rule.severity,
                                content: `[DAILY] ${rule.content}`
                            });
                         }
                    }
                });
             } catch (e) {
                 console.error("Recurring Read Error:", e.message);
             }
        }

    }, 1000); // Check every 1 second
}

// --- 5. NOTIFICATION SENDER (HIGH PRIORITY) ---
async function sendNotifications(alertData) {
    const tokensSnapshot = await db.ref("fcm_tokens").once("value");
    if (!tokensSnapshot.exists()) return;

    const tokens = [];
    tokensSnapshot.forEach(child => {
        const t = child.val().token;
        if (t) tokens.push(t);
    });

    if (tokens.length === 0) return;

    // 💡 STRATEGY: High Priority Notification Message
    // By including the 'notification' key at the top level, we force the Android OS
    // to display the alert even if the browser process is completely killed.
    const payload = {
        notification: {
            title: `🚨 ${alertData.severity} ALERT`,
            body: `${alertData.content}`,
        },
        data: {
            alertId: alertData.id,
            severity: alertData.severity,
            forceAlarm: "true",
            timestamp: Date.now().toString(),
            url: "https://japs-parivar-siren.web.app/?emergency=true"
        },
        android: {
            priority: "high", // Critical for waking up Doze mode
            ttl: 0,
            notification: {
                sound: "default", // Plays the system notification sound
                priority: "max",  // Heads up notification
                channelId: "sentinel_channel", // Important for Android 8+
                visibility: "public",
                clickAction: "FLUTTER_NOTIFICATION_CLICK" // Standard compat handling
            }
        },
        webpush: {
            headers: { 
                Urgency: "high"
            },
            fcm_options: {
                link: "https://japs-parivar-siren.web.app/?emergency=true"
            }
        }
    };

    try {
        const response = await messaging.sendEachForMulticast({
            tokens: tokens,
            ...payload
        });
        console.log(`🚀 Sent to ${response.successCount} devices (OS Priority Mode).`);
    } catch (e) {
        console.error("🔥 Error sending:", e);
    }
}

startHeartbeat();
startMasterScheduler();
