# 🚀 How to Deploy to GitHub Pages

Since you already have the code, follow these steps to make your app live using your GitHub repository.

## Prerequisites
1. You must have **Git** installed.
2. You must have a **GitHub Account**.
3. You should have created a **New Repository** on GitHub (empty).

## Step 1: Connect to GitHub
Open your terminal (Command Prompt or VS Code Terminal) in the project folder and run these commands one by one.

Replace `<YOUR_USERNAME>` and `<REPO_NAME>` with your actual details.

```bash
# 1. Initialize Git (if you haven't already)
git init

# 2. Add all files to the staging area
git add .

# 3. Commit the changes
git commit -m "Initial commit for Sentinel App"

# 4. Rename branch to main
git branch -M main

# 5. Link to your GitHub Repository
# REPLACE THE URL BELOW WITH YOUR ACTUAL REPO URL
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git

# 6. Push the code to GitHub
git push -u origin main
```

## Step 2: Publish the App
Your `package.json` is already configured with the necessary scripts (`gh-pages`).

Run this command in your terminal:

```bash
npm run deploy
```

**What this does:**
1. It runs `npm run build` to create the production version of your app (in the `dist` folder).
2. It pushes that folder to a special branch called `gh-pages` on your GitHub repo.

## Step 3: Enable GitHub Pages
1. Go to your repository on **GitHub.com**.
2. Click **Settings** (top right tab of the repo).
3. On the left sidebar, click **Pages**.
4. Under "Build and deployment" > "Source", select **Deploy from a branch**.
5. Under "Branch", ensure **gh-pages** is selected as the branch and **/(root)** is the folder.
6. Click **Save**.

Wait about 1-2 minutes. Refresh the page. You will see a banner saying:
> "Your site is live at https://<username>.github.io/<repo-name>/"

## Step 4: Final Configuration
1. Open that live URL on your phone or computer.
2. Go to `/admin` (e.g., `https://.../repo-name/#/admin`).
3. Log in (`admin` / `yogiji`).
4. Go to **Settings**.
5. Paste your Firebase Database URL (from the `.env` or previous setup).
6. Click **Save & Connect**.

Your app is now live and fully functional!
