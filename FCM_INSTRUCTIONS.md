
# 🚨 Enabling "App Killed" Notifications (Advanced)

To receive alerts when the app is completely closed (swiped away), you must deploy the Backend Code (`functions/`) to Google Cloud.

## Prerequisites
1. Install Node.js on your computer.
2. Install Firebase Tools:
   ```bash
   npm install -g firebase-tools
   ```

## Step 1: Initialize Firebase in Project
1. Open your terminal in the project root.
2. Login to Google:
   ```bash
   firebase login
   ```
3. Initialize the project:
   ```bash
   firebase init
   ```
4. Select **Functions** and **Realtime Database**.
5. Select **Use an existing project** (Select your "Sentinel" project).
6. Language: **JavaScript**.
7. Overwrite files? **NO** (Keep the files I created for you in `functions/`).
8. Install dependencies? **YES**.

## Step 2: Configure Keys
1. Open `src/services/firebase.ts`.
2. Fill in the `firebaseConfig` object with your details from Firebase Console > Project Settings.
3. Open `public/firebase-messaging-sw.js`.
4. Fill in the `firebaseConfig` there as well.

## Step 3: Deploy the Backend
Run this command to upload the backend script to Google's servers:

```bash
firebase deploy --only functions
```

## Step 4: Test
1. Open the app on your phone.
2. It should ask for "Notification Permission". Click Allow.
3. Close the app completely (Swipe it away).
4. On your PC (Admin Panel), create a new Alert.
5. Within 5-10 seconds, your phone should buzz/ring with the notification from the cloud.
