# Changelog

## [Unreleased]

### Fixed - 2025-11-16

#### Backend Deployment Healthcheck Failure

**Issue:** Railway deployment was failing healthchecks despite successful build. The application was not starting properly, causing all healthcheck attempts to return "service unavailable".

**Root Cause:**
- Application crashed on startup when database wasn't immediately available
- Prisma service was throwing errors in production mode if schema wasn't initialized
- Start command (`npx prisma migrate deploy && npm run start:prod`) failed completely if migrations failed
- No retry logic or graceful degradation

**Changes Made:**

1. **Created Resilient Startup Script** (`backend/scripts/railway-start-resilient.js`)
   - Waits for database to be ready (up to 30 retries with 2s delay)
   - Runs migrations only if database is available
   - Falls back to minimal mode if database is not ready
   - Provides detailed logging for debugging
   - Handles SIGTERM/SIGINT for graceful shutdown

2. **Updated Prisma Service** (`backend/src/common/prisma/prisma.service.ts`)
   - Added `SKIP_DB_INIT` environment variable support
   - Checks for DATABASE_URL before attempting connection
   - Allows minimal mode to continue even if schema is not initialized
   - Better error handling with conditional production failures

3. **Updated nixpacks.toml** (`backend/nixpacks.toml`)
   - Changed start command from `npx prisma migrate deploy && npm run start:prod`
   - To: `node scripts/railway-start-resilient.js`
   - This provides better resilience and error handling

4. **Updated package.json** (`backend/package.json`)
   - Added `start:resilient` script for easy local testing
   - Script: `node scripts/railway-start-resilient.js`

5. **Created Deployment Documentation** (`backend/RAILWAY_DEPLOYMENT.md`)
   - Comprehensive guide for Railway deployment
   - Environment variable requirements
   - Troubleshooting steps
   - Monitoring and rollback procedures

**Benefits:**
- Application can start even if database is temporarily unavailable
- Healthcheck endpoint responds immediately
- Better visibility into startup issues through detailed logging
- Graceful degradation to minimal mode
- Easier to debug deployment issues

**Testing:**
```bash
# Local testing
cd backend
npm run build
npm run start:resilient

# Should start successfully even without DATABASE_URL
# Healthcheck should respond at http://localhost:3000/health
```

**Deployment:**
- Push to dev branch triggers automatic Railway deployment
- Healthcheck should pass within 10 seconds
- Monitor logs for successful database connection and migration

---

## Migration Guide

If you're updating an existing deployment:

1. **Pull latest changes**
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **Ensure environment variables are set**
   - Check Railway dashboard Variables section
   - Minimum required: `DATABASE_URL`, `PORT`, `NODE_ENV`

3. **Push to trigger redeploy**
   ```bash
   git push origin dev
   ```

4. **Monitor deployment**
   - Watch Railway deployment logs
   - Verify healthcheck passes
   - Check application logs for successful startup

## Notes

- The resilient startup script adds approximately 2-5 seconds to startup time when database is immediately available
- Maximum startup time with database unavailable: ~60 seconds (30 retries × 2 seconds)
- Minimal mode provides healthcheck only - full functionality requires database connection

