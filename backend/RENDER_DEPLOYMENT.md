# Deploying Backend to Render

This guide will help you deploy the PlanTakeoff backend API to Render.

## Prerequisites

- A Render account (sign up at https://render.com)
- GitHub repository with your code
- OpenAI API key (for plan analysis functionality)

## Quick Start

### Option 1: Using render.yaml (Recommended)

1. **Connect your repository to Render:**
   - Go to https://dashboard.render.com
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Select the repository and branch
   - Render will automatically detect `render.yaml` in the `backend/` directory

2. **Set required environment variables:**
   After the services are created, go to your web service and add:
   - `OPENAI_API_KEY` - Your OpenAI API key (required for plan analysis)
   - `WASABI_ACCESS_KEY_ID` - (Optional) For cloud file storage
   - `WASABI_SECRET_ACCESS_KEY` - (Optional) For cloud file storage
   - `WASABI_BUCKET_NAME` - (Optional) For cloud file storage

3. **Run database migrations:**
   - Go to your web service → "Shell"
   - Run: `npm run db:migrate:prod`
   - Or add this as a post-deploy script

4. **Deploy:**
   - Render will automatically deploy when you push to your connected branch
   - Or manually trigger a deploy from the dashboard

### Option 2: Manual Setup

1. **Create PostgreSQL Database:**
   - Go to Render Dashboard → "New +" → "PostgreSQL"
   - Name: `plantakeoff-db`
   - Region: Choose closest to you
   - Plan: Starter (or higher for production)
   - Copy the `Internal Database URL` (you'll need it)

2. **Create Redis Instance:**
   - Go to Render Dashboard → "New +" → "Redis"
   - Name: `plantakeoff-redis`
   - Region: Same as database
   - Plan: Starter
   - Copy the `Internal Redis URL` (you'll need it)

3. **Create Web Service:**
   - Go to Render Dashboard → "New +" → "Web Service"
   - Connect your GitHub repository
   - Settings:
     - **Name:** `plantakeoff-api`
     - **Root Directory:** `backend`
     - **Environment:** `Node`
     - **Build Command:** `npm install && npm run build && npm run db:generate`
     - **Start Command:** `npm run start:prod`
     - **Health Check Path:** `/health`

4. **Configure Environment Variables:**
   In your web service, go to "Environment" and add:

   **Required:**

   ```bash
   NODE_ENV=production
   PORT=10000
   DATABASE_URL=<from PostgreSQL service>
   JWT_SECRET=<generate a strong random string>
   OPENAI_API_KEY=<your OpenAI API key>
   ```

   **Optional but Recommended:**

   ```bash
   REDIS_URL=<from Redis service>
   MINIMAL_START=false
   API_PREFIX=v1
   JWT_EXPIRES_IN=24h
   CORS_ORIGIN=*
   RATE_LIMIT_TTL=60
   RATE_LIMIT_MAX=100
   LOG_LEVEL=info
   ```

   **Optional (for cloud storage):**

   ```bash
   WASABI_ENDPOINT=https://s3.wasabisys.com
   WASABI_REGION=us-east-1
   WASABI_ACCESS_KEY_ID=<your key>
   WASABI_SECRET_ACCESS_KEY=<your secret>
   WASABI_BUCKET_NAME=plantakeoff-files
   ```

5. **Run Database Migrations:**
   - After first deployment, go to your web service → "Shell"
   - Run: `npm run db:migrate:prod`
   - This will set up your database schema

6. **Deploy:**
   - Click "Manual Deploy" → "Deploy latest commit"
   - Or push to your connected branch for automatic deploys

## Environment Variables Reference

### Required Variables

| Variable         | Description                      | Example                  |
| ---------------- | -------------------------------- | ------------------------ |
| `DATABASE_URL`   | PostgreSQL connection string     | Auto-set by Render       |
| `JWT_SECRET`     | Secret key for JWT tokens        | Generate a random string |
| `OPENAI_API_KEY` | OpenAI API key for plan analysis | `sk-proj-...`            |

### Optional Variables

| Variable         | Description                 | Default                              |
| ---------------- | --------------------------- | ------------------------------------ |
| `REDIS_URL`      | Redis connection string     | Not set (jobs process synchronously) |
| `PORT`           | Server port                 | `10000` (Render default)             |
| `NODE_ENV`       | Environment                 | `production`                         |
| `API_PREFIX`     | API route prefix            | `v1`                                 |
| `MINIMAL_START`  | Use minimal app module      | `false`                              |
| `JWT_EXPIRES_IN` | JWT token expiration        | `24h`                                |
| `CORS_ORIGIN`    | Allowed CORS origins        | `*`                                  |
| `RATE_LIMIT_TTL` | Rate limit window (seconds) | `60`                                 |
| `RATE_LIMIT_MAX` | Max requests per window     | `100`                                |
| `LOG_LEVEL`      | Logging level               | `info`                               |

### Storage Variables (Optional)

If you want persistent file storage instead of ephemeral container storage:

| Variable                   | Description        |
| -------------------------- | ------------------ |
| `WASABI_ENDPOINT`          | Wasabi S3 endpoint |
| `WASABI_REGION`            | Wasabi region      |
| `WASABI_ACCESS_KEY_ID`     | Wasabi access key  |
| `WASABI_SECRET_ACCESS_KEY` | Wasabi secret key  |
| `WASABI_BUCKET_NAME`       | Wasabi bucket name |

## Post-Deployment Steps

1. **Verify Health Check:**
   - Visit: `https://your-service.onrender.com/health`
   - Should return: `{"status":"ok"}`

2. **Check API Documentation:**
   - Visit: `https://your-service.onrender.com/docs`
   - Swagger UI should load

3. **Test Database Connection:**
   - Check service logs for: `✅ Database connected`
   - No errors about database connection

4. **Test Redis Connection (if configured):**
   - Check logs for: `[JobsService] Job queue connected and ready`
   - Not: `⚠️ Job queue not available`

5. **Test OpenAI Integration:**
   - Upload a plan file via API
   - Start a job
   - Check logs for OpenAI API calls

## Troubleshooting

### JavaScript Heap Out of Memory Error

**Error:** `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`

**Causes:**

1. Render is using `npm start` (development mode) instead of production start command
2. Build process is running out of memory
3. Node.js default heap size is too small

**Solutions:**

1. **Check Start Command:**
   - Go to your web service → "Settings" → "Build & Deploy"
   - **Start Command** should be: `node --max-old-space-size=512 dist/main.js`
   - NOT: `npm start` or `nest start`
   - If using render.yaml, it should be set automatically

2. **If you set up manually (not using Blueprint):**
   - Go to web service → "Settings"
   - Under "Build & Deploy":
     - **Build Command:** `npm install && npm run build && npm run db:generate`
     - **Start Command:** `node --max-old-space-size=512 dist/main.js`
   - Save changes and redeploy

3. **Verify Build Completed:**
   - Check build logs for: `✅ Build completed successfully`
   - Ensure `dist/` folder exists with compiled files
   - If build fails, fix build errors first

4. **Increase Memory (if still failing):**
   - Add environment variable: `NODE_OPTIONS=--max-old-space-size=1024`
   - Or upgrade to a higher plan with more memory
   - Update start command to: `node --max-old-space-size=1024 dist/main.js`

5. **Check Root Directory:**
   - If your repo has a `backend/` folder, set **Root Directory** to `backend`
   - This ensures Render runs commands in the correct directory

### Build Fails

**Error:** `Cannot find module '@nestjs/...'`

- **Fix:** Ensure `package.json` has all dependencies
- Run `npm install` locally to verify

**Error:** `Prisma Client not generated`

- **Fix:** Build command should include `npm run db:generate`
- Check that `prisma/schema.prisma` exists

### Application Won't Start

**Error:** `Database connection failed`

- **Fix:** Verify `DATABASE_URL` is set correctly
- Check PostgreSQL service is running
- Ensure database is in same region as web service

**Error:** `Port already in use`

- **Fix:** Render sets `PORT` automatically, don't override it
- Use `process.env.PORT` in your code (already done)

**Error:** `JWT_SECRET is required`

- **Fix:** Add `JWT_SECRET` environment variable
- Generate a strong random string

### Jobs Not Processing

**Symptom:** Jobs stay in `QUEUED` status

- **Check:** Logs for `⚠️ Job queue not available`
- **Fix:** Add Redis service and set `REDIS_URL`
- Or jobs will process synchronously (slower)

### OpenAI Errors

**Error:** `OpenAI API authentication failed`

- **Fix:** Verify `OPENAI_API_KEY` is set correctly
- Check API key is valid and has credits
- Key should start with `sk-` or `sk-proj-`

## Render-Specific Notes

1. **Free Tier Limitations:**
   - Services spin down after 15 minutes of inactivity
   - First request after spin-down takes ~30 seconds
   - Upgrade to paid plan for always-on services

2. **Database Migrations:**
   - Run migrations manually via Shell after first deploy
   - Or add a post-deploy script (not included in render.yaml)

3. **File Storage:**
   - Without Wasabi, files are stored in `/tmp` (ephemeral)
   - Files are lost on container restart
   - Use Wasabi or similar for production

4. **Health Checks:**
   - Render uses `/health` endpoint for health checks
   - Service must respond within timeout or it's marked unhealthy

5. **Build Time:**
   - First build may take 5-10 minutes
   - Subsequent builds are faster (cached dependencies)

## Cost Estimation

**Starter Plan (Free Tier):**

- Web Service: Free (with limitations)
- PostgreSQL: Free (limited)
- Redis: Free (limited)

**Paid Plans:**

- Web Service: ~$7/month (Starter)
- PostgreSQL: ~$7/month (Starter)
- Redis: ~$10/month (Starter)

**Total:** ~$24/month for always-on production setup

## Next Steps

1. Set up custom domain (optional)
2. Configure SSL (automatic with Render)
3. Set up monitoring and alerts
4. Configure backup strategy for database
5. Set up CI/CD for automatic deployments

## Support

- Render Docs: https://render.com/docs
- Render Community: https://community.render.com
- Project Issues: Check your repository issues
