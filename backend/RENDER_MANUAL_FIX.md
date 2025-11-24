# URGENT: Fix Start Command in Render Dashboard

## The Problem

Render is still running `npm start` which causes memory errors. You **MUST** manually update the start command in the Render dashboard.

## Step-by-Step Fix (Do This Now)

### 1. Go to Your Render Dashboard

1. Open https://dashboard.render.com
2. Click on your web service (the one that's failing)

### 2. Update Start Command

1. Click the **"Settings"** tab (left sidebar)
2. Scroll down to **"Build & Deploy"** section
3. Find the **"Start Command"** field
4. **DELETE** whatever is there (probably `npm start` or empty)
5. **PASTE** this exact command:
   ```
   node --max-old-space-size=512 dist/main.js
   ```
6. Click **"Save Changes"** button at the bottom

### 3. Verify Build Command

While you're there, check **"Build Command"** is:
```
npm install && npm run build && npm run db:generate
```

### 4. Check Root Directory

1. Still in Settings, find **"Root Directory"** field
2. If your code is in a `backend/` folder, set it to: `backend`
3. If your code is at the root, leave it empty or set to: `.`

### 5. Add Environment Variable (Important!)

1. Click the **"Environment"** tab (left sidebar)
2. Click **"Add Environment Variable"**
3. Add:
   - **Key:** `NODE_OPTIONS`
   - **Value:** `--max-old-space-size=512`
4. Click **"Save Changes"**

### 6. Redeploy

1. Click the **"Manual Deploy"** tab
2. Click **"Deploy latest commit"**
3. Wait for the build to complete
4. Check the logs - you should see:
   ```
   🚀 Starting PlanTakeoff API...
   ✅ PlanTakeoff API is running on port...
   ```

## What to Look For

**✅ CORRECT (after fix):**
- Logs show: `node --max-old-space-size=512 dist/main.js`
- Logs show: `🚀 Starting PlanTakeoff API...`
- No memory errors

**❌ WRONG (current state):**
- Logs show: `npm start` or `nest start`
- Memory errors
- Build fails

## If It Still Fails

1. **Check build completed:**
   - Look for `✅ Build completed` in build logs
   - Verify `dist/main.js` exists

2. **Increase memory:**
   - Change start command to: `node --max-old-space-size=1024 dist/main.js`
   - Update `NODE_OPTIONS` to: `--max-old-space-size=1024`

3. **Check if using Blueprint:**
   - If you used Blueprint, the render.yaml should work
   - But you may still need to manually update if it didn't apply

## Why This Happens

- Render might be detecting `nixpacks.toml` or `package.json` scripts
- Manual setup doesn't always read `render.yaml` correctly
- The default behavior is to run `npm start` if no start command is specified

## Quick Reference

**Start Command:**
```
node --max-old-space-size=512 dist/main.js
```

**Build Command:**
```
npm install && npm run build && npm run db:generate
```

**Environment Variable:**
```
NODE_OPTIONS=--max-old-space-size=512
```

