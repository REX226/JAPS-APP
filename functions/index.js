
/**
 * THIS CODE RUNS ON GOOGLE CLOUD, NOT IN THE BROWSER.
 * You must deploy this using 'firebase deploy --only functions'
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.onAlertListUpdate = functions.database.ref("/sentinel_alerts_v1")
    .onWrite(async (change, context) => {
        const afterData = change.after.val(); 
        const beforeData = change.before.val();
        
        if (!afterData || afterData.length === 0) return null;

        // Get the latest alert
        const latestAlert = afterData[afterData.length - 1];
        
        // Basic check: Is this actually a new alert?
        const previousLastId = beforeData && beforeData.length > 0 
            ? beforeData[beforeData.length - 1].id 
            : null;

        if (latestAlert.id === previousLastId) {
            return null; // No new alert added
        }

        console.log("New Alert Detected:", latestAlert.content);

        // 2. Prepare the Notification Payload
        // To bypass Silent Mode/Doze Mode, we need high priority headers
        const payload = {
            notification: {
                title: `🚨 ${latestAlert.severity} ALERT`,
                body: latestAlert.content,
            },
            data: {
                alertId: latestAlert.id,
                severity: latestAlert.severity,
                // Custom data flag to tell the SW to be extra annoying
                forceAlarm: "true" 
            }
        };

        // 3. Get all Device Tokens
        const tokensSnapshot = await admin.database().ref("fcm_tokens").once("value");
        if (!tokensSnapshot.exists()) return null;

        const tokens = [];
        tokensSnapshot.forEach(child => {
            const t = child.val().token;
            if (t) tokens.push(t);
        });

        if (tokens.length === 0) return null;

        // 4. Send Multicast Message
        const response = await admin.messaging().sendEachForMulticast({
            tokens: tokens,
            notification: payload.notification,
            data: payload.data,
            // Android specific settings for high priority
            android: {
                priority: "high", // Wakes the device
                ttl: 0, // Deliver immediately or fail
                notification: {
                    priority: "max", // Heads-up notification
                    channelId: "sentinel_channel",
                    defaultSound: true,
                    visibility: "public",
                    // Keep the notification LED on or vibration active
                    notificationCount: 1
                }
            },
            // Web Push Headers
            webpush: {
                headers: {
                    Urgency: "high"
                },
                notification: {
                    requireInteraction: true, // Stays until clicked
                    renotify: true, // Vibrate even if another notification exists
                    tag: "sentinel-alert"
                }
            }
        });

        console.log("Notifications sent:", response.successCount);
        return null;
    });
