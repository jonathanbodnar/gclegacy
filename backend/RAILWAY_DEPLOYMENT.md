# Railway Deployment Guide for GC Legacy Backend

## Issue Summary (Nov 16, 2025)

**Problem:** Backend build succeeded but healthcheck failed repeatedly with "service unavailable"

**Root Cause:** 
- The app was crashing on startup when trying to connect to the database
- Prisma was throwing errors if the database wasn't immediately available
- The start command ran migrations first, which would fail if DATABASE_URL was missing or database wasn't ready

**Solution:**
- Created a resilient startup script (`railway-start-resilient.js`) that:
  - Waits for database to be ready (with retries)
  - Runs migrations only if database is available
  - Falls back to minimal mode if database is not ready
  - Provides graceful error handling

## Environment Variables Required

Make sure these environment variables are set in Railway:

### Required
```bash
DATABASE_URL=postgresql://username:password@host:port/database
PORT=3000  # Railway sets this automatically
NODE_ENV=production
```

### Optional (but recommended)
```bash
# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=24h

# OpenAI API (for AI-powered features)
OPENAI_API_KEY=sk-...

# Redis (for queues)
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Storage (Wasabi S3-Compatible)
WASABI_ENDPOINT=https://s3.wasabisys.com
WASABI_REGION=us-east-1
WASABI_ACCESS_KEY_ID=your-access-key
WASABI_SECRET_ACCESS_KEY=your-secret-key
WASABI_BUCKET_NAME=plantakeoff-files

# API Configuration
API_PREFIX=v1
CORS_ORIGIN=*
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
```

## Deployment Steps

### 1. Connect Railway to GitHub
```bash
# Make sure your code is pushed to the dev branch
git add .
git commit -m "Fix: Resilient startup for Railway deployment"
git push origin dev
```

### 2. Set Up Railway Project

1. Go to [Railway.app](https://railway.app)
2. Create a new project
3. Choose "Deploy from GitHub repo"
4. Select your `gclegacy` repository
5. Choose the `dev` branch

### 3. Configure the Service

1. In Railway dashboard, select your backend service
2. Go to **Settings** → **Root Directory**
3. Set it to: `backend`

### 4. Add Database

Option A: **Railway PostgreSQL (Recommended)**
1. Click "New" → "Database" → "PostgreSQL"
2. Railway will automatically set the `DATABASE_URL` environment variable

Option B: **External Database**
1. Go to service **Variables**
2. Add `DATABASE_URL` with your connection string

### 5. Set Environment Variables

Go to **Variables** tab and add the required variables listed above.

### 6. Deploy

Railway will automatically deploy when you push to the `dev` branch.

## Monitoring Deployment

### Check Build Logs
1. Go to **Deployments** tab
2. Click on the latest deployment
3. View the build logs

### Check Runtime Logs
1. After deployment, go to the **Logs** tab
2. You should see:
   ```
   🚀 Starting PlanTakeoff API...
   🔍 Waiting for database to be ready...
   ✅ Database is ready!
   📦 Generating Prisma client...
   🗄️ Running database migrations...
   ✅ Migrations completed successfully!
   🎯 Starting NestJS application...
   ✅ PlanTakeoff API is running on port 3000
   ```

### Verify Healthcheck
1. Get your Railway app URL (e.g., `https://your-app.up.railway.app`)
2. Visit: `https://your-app.up.railway.app/health`
3. You should see a JSON response:
   ```json
   {
     "status": "ok",
     "timestamp": "2025-11-16T...",
     "service": "plantakeoff-api",
     "version": "0.1.0",
     "uptime": 123.45,
     "memory": {...},
     "pid": 1
   }
   ```

## Troubleshooting

### Healthcheck Still Failing?

1. **Check DATABASE_URL**
   ```bash
   # In Railway service, go to Variables
   # Make sure DATABASE_URL is set correctly
   ```

2. **Check Logs for Errors**
   ```bash
   # Look for error messages in the deployment logs
   # Common errors:
   # - "Database initialization failed"
   # - "Cannot find module"
   # - Port already in use
   ```

3. **Test Database Connection**
   - Make sure your PostgreSQL service is running
   - Verify the DATABASE_URL format:
     ```
     postgresql://user:password@host:port/database
     ```

4. **Restart the Service**
   - Go to Settings → "Restart" button
   - This will redeploy with the latest code

### App Starts But APIs Don't Work?

1. **Check if minimal mode is active**
   - Look for "⚠️ Starting in minimal mode" in logs
   - This means database connection failed
   - Only `/health` endpoint will work in minimal mode

2. **Check Module Loading**
   - Look for "Using Minimal App Module" vs "Using Full App Module"
   - Full module needs database to be available

3. **Set MINIMAL_START=false**
   - If you want to force full app mode (not recommended for first deploy)
   - Add `MINIMAL_START=false` to environment variables

### Database Migrations Not Running?

If you see "⚠️ Continuing without migrations":

1. **Run migrations manually**
   ```bash
   # In Railway service terminal
   npx prisma migrate deploy
   ```

2. **Check Prisma Schema**
   - Make sure `prisma/schema.prisma` is correct
   - DATABASE_URL should use `env("DATABASE_URL")`

## Minimal vs Full Mode

### Minimal Mode
- **When:** Database not available or `MINIMAL_START=true`
- **Features:** Only health check endpoints
- **Purpose:** Fast startup for health checks

### Full Mode
- **When:** Database available and `MINIMAL_START=false`
- **Features:** All API endpoints and features
- **Purpose:** Normal production operation

## Updating the Deployment

```bash
# 1. Make changes to code
# 2. Commit and push to dev branch
git add .
git commit -m "Your change description"
git push origin dev

# Railway will automatically rebuild and redeploy
```

## Rolling Back

If something goes wrong:

1. Go to **Deployments** tab
2. Find a previous successful deployment
3. Click the three dots → "Redeploy"

## Support

If issues persist:
1. Check Railway status: https://railway.app/status
2. Review Railway docs: https://docs.railway.app
3. Check application logs in Railway dashboard

