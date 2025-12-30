
# ☁️ How to Run Sentinel 24/7 on Render.com

Since Vercel only hosts the visual app, you need a separate server to run the `monitor-local.js` script. This script is responsible for:
1. Sending notifications when phones are locked (using high-priority FCM data).
2. Processing recurring alerts.
3. Updating the "Monitor Status" in the Admin Dashboard.

## Step 1: Get your Secret Key
1. Find the `service-account.json` file on your computer.
2. Open it in a text editor.
3. **Copy the entire content** (it starts with `{` and ends with `}`).

## Step 2: Create Render Service
1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Settings:
   - **Name:** `sentinel-monitor`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node monitor-local.js`
   - **Instance Type:** Free

## Step 3: Configure Variables
Scroll down to **Environment Variables** and add:

1. **Key:** `FIREBASE_SERVICE_ACCOUNT`
   **Value:** (Paste the JSON content you copied in Step 1)

2. **Key:** `NODE_VERSION`
   **Value:** `20.0.0`

3. **Key:** `DB_URL` (Optional)
   **Value:** `https://japs-parivar-siren-default-rtdb.firebaseio.com`

Click **Create Web Service**.

## Step 4: Keep it Awake
Render Free Tier sleeps after 15 minutes. To prevent this:

1. Copy your Render App URL (e.g., `https://sentinel-monitor.onrender.com`).
2. Go to [Cron-Job.org](https://cron-job.org/en/) (Free).
3. Create a new Cron Job.
4. **URL:** Your Render URL.
5. **Schedule:** Every 5 minutes.
6. **Save.**

## Step 5: Verify
1. Open your Vercel App.
2. Go to **Admin Dashboard** -> **Settings**.
3. The Monitor Status should be **ONLINE**.
