
/**
 * SENTINEL MONITOR (CLOUD READY)
 * 
 * 1. Checks for new alerts in Realtime DB.
 * 2. Sends "App Killed" Push Notifications.
 * 3. Sends Heartbeat to Admin Dashboard.
 * 4. Checks Recurring Rules every minute.
 * 5. Checks Scheduled One-Time Alerts.
 * 6. Hosts a HTTP Health Check for Uptime Monitors.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
import http from 'http';

const admin = require("firebase-admin");
const fs = require("fs");

// --- CONFIGURATION ---
const MANUAL_DB_URL = process.env.DB_URL || "https://japs-parivar-siren-default-rtdb.firebaseio.com"; 

console.log("\n========================================");
console.log("   🛡️  SENTINEL MONITOR INITIALIZING");
console.log("========================================");

// --- 1. SETUP CREDENTIALS (FILE OR ENV) ---
let serviceAccount;
const keyFileName = "service-account.json";

// A. Try loading from Environment Variable (Best for Render/Cloud)
const envCreds = process.env.FIREBASE_SERVICE_ACCOUNT;
if (envCreds) {
    try {
        console.log("🔐 Found FIREBASE_SERVICE_ACCOUNT env var. Parsing...");
        // Handle potential formatting issues (trim whitespace)
        serviceAccount = JSON.parse(envCreds.trim());
        console.log("✅ Credentials successfully parsed from Environment.");
    } catch (e) {
        console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT env var.");
        console.error("Error details:", e.message);
        console.error("First 20 chars of your key:", envCreds.substring(0, 20) + "...");
        console.error("HINT: Ensure you copied the entire JSON object { ... } and didn't add extra quotes.");
    }
} else {
    console.log("⚠️ No FIREBASE_SERVICE_ACCOUNT env var found. Checking local file...");
}

// B. Try loading from Local File (Best for PC)
if (!serviceAccount) {
    if (fs.existsSync(`./${keyFileName}`)) {
        console.log(`✅ Loading credentials from local file: ${keyFileName}`);
        serviceAccount = require(`./${keyFileName}`);
    } else {
        console.log(`ℹ️ Local file ./${keyFileName} not found.`);
    }
}

// C. FAIL IF NOTHING FOUND
if (!serviceAccount) {
    console.error("\n❌ CRITICAL STARTUP ERROR: No Credentials Available");
    console.error("---------------------------------------------------");
    console.error("The Monitor cannot start because it has no access to Firebase.");
    console.error("\nIF YOU ARE ON RENDER.COM:");
    console.error("1. Go to your Dashboard -> Environment Variables.");
    console.error("2. Ensure Key is EXACTLY: FIREBASE_SERVICE_ACCOUNT");
    console.error("3. Ensure Value is the ENTIRE content of service-account.json (starts with { ends with })");
    console.error("4. IMPORTANT: If you just pushed code, wait for the new build.");
    console.error("\nIF YOU ARE ON LOCAL PC:");
    console.error(`1. Put '${keyFileName}' in this folder.`);
    process.exit(1);
}

// Determine Database URL
const dbUrl = MANUAL_DB_URL;

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

// --- 2. HTTP SERVER (REQUIRED FOR CLOUD HOSTING) ---
// Cloud providers (Render, Heroku) check PORT to see if app is alive.
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end(`Sentinel Monitor is Running... Status: ONLINE. Time: ${new Date().toISOString()}`);
});

server.listen(PORT, () => {
    console.log(`\n🌐 HTTP Health Server listening on port ${PORT}`);
});

// --- 3. CONNECTION CHECK ---
db.ref(".info/connected").on("value", (snap) => {
    if (snap.val() === true) {
        console.log("🟢 Database Connected! Monitoring timeline...");
    } else {
        console.log("🟡 Connecting to Database...");
    }
});

// --- 4. HEARTBEAT SYSTEM ---
function startHeartbeat() {
    const updateStatus = () => {
        statusRef.update({
            online: true,
            last_seen: Date.now()
        }).catch(() => {});
    };

    updateStatus();
    setInterval(updateStatus, 2000);
}

// --- 5. MASTER SCHEDULER ---
function startMasterScheduler() {
    console.log("⏰ Scheduler Active: Checking for alerts every 1 second...");

    setInterval(async () => {
        const now = Date.now();
        const dateObj = new Date();
        const currentTimeStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
        const currentSeconds = dateObj.getSeconds();

        // A. CHECK STANDARD ALERTS
        try {
            const snapshot = await alertsRef.once('value');
            const val = snapshot.val();
            
            if (val) {
                const allAlerts = Array.isArray(val) ? val : Object.values(val);
                for (const alert of allAlerts) {
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

        // B. CHECK RECURRING ALERTS
        if (currentSeconds < 5) {
             try {
                const snap = await recurringRef.once('value');
                const val = snap.val();
                const rules = val ? (Array.isArray(val) ? val : Object.values(val)) : [];

                rules.forEach(async (rule) => {
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
    }, 1000); 
}

// --- 6. NOTIFICATION SENDER ---
async function sendNotifications(alertData) {
    const tokensSnapshot = await db.ref("fcm_tokens").once("value");
    if (!tokensSnapshot.exists()) return;

    const tokens = [];
    tokensSnapshot.forEach(child => {
        const t = child.val().token;
        if (t) tokens.push(t);
    });

    if (tokens.length === 0) return;

    // Data-Only Payload (Forces Service Worker execution)
    const payload = {
        data: {
            title: `🚨 ${alertData.severity} ALERT`,
            body: `${alertData.content}`,
            alertId: alertData.id,
            severity: alertData.severity,
            forceAlarm: "true",
            timestamp: Date.now().toString(),
            url: "https://japs-parivar-siren.web.app/?emergency=true"
        },
        android: { priority: "high", ttl: 0 },
        webpush: { headers: { Urgency: "high" }, fcm_options: { link: "https://japs-parivar-siren.web.app/?emergency=true" } }
    };

    try {
        const response = await messaging.sendEachForMulticast({ tokens: tokens, ...payload });
        console.log(`🚀 Sent to ${response.successCount} devices.`);
    } catch (e) {
        console.error("🔥 Error sending:", e);
    }
}

startHeartbeat();
startMasterScheduler();
