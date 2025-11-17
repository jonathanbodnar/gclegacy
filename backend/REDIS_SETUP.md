# Adding Redis to Railway for Job Queue Processing

## Why Redis is Needed

The PlanTakeoff backend uses **Bull** (job queue library) to process takeoff jobs asynchronously. Without Redis:
- Jobs are created but not processed
- The "Start Analysis" button creates jobs in `QUEUED` status
- Jobs sit idle with error message: "Queue not available"

With Redis:
- Jobs are automatically processed in the background
- Real-time progress updates
- Retry logic for failed jobs
- Better performance and scalability

## Step-by-Step: Add Redis to Railway

### 1. Add Redis Database

1. Go to your Railway project dashboard
2. Click the **"New"** button
3. Select **"Database"**
4. Choose **"Redis"**
5. Railway will create a new Redis service

### 2. Link Redis to Backend

Railway automatically creates these variables when you add Redis:
- `REDIS_URL` - Full connection string (e.g., `redis://default:password@redis.railway.internal:6379`)

Your backend code now supports **both** connection methods:

**Option A: Use REDIS_URL (Easiest - Already Configured)**

The code will automatically detect `REDIS_URL` if it exists. No additional configuration needed! ✅

**Option B: Use Individual Variables (Manual)**

If you prefer explicit variables, add these to your backend service:

```bash
REDIS_HOST=${{Redis.RAILWAY_PRIVATE_DOMAIN}}
REDIS_PORT=6379
REDIS_PASSWORD=${{Redis.REDIS_PASSWORD}}
```

### 3. Verify Connection

After adding Redis and redeploying, check the logs for:

```
[InstanceLoader] BullModule dependencies initialized
⚠️  Job queue not available - jobs will be processed synchronously
```

Should change to:
```
[InstanceLoader] BullModule dependencies initialized +70ms
[JobsService] Job queue connected and ready
```

### 4. Test Job Processing

1. Upload a plan file
2. Click "Start Analysis"
3. Job should be created with status `QUEUED`
4. Within seconds, status should change to `PROCESSING`
5. Then `COMPLETED` when finished

## Troubleshooting

### Redis Connection Errors

If you see:
```
MaxRetriesPerRequestError: Reached the max retries per request limit
```

**Check:**
1. Redis service is running (green checkmark in Railway)
2. `REDIS_URL` variable is set in backend service
3. Backend and Redis are in the same Railway project

**Fix:** Railway should automatically link services. If not:
- Go to backend service → Variables
- Add variable reference: `REDIS_URL=${{Redis.REDIS_URL}}`

### Jobs Still Not Processing

If jobs stay in `QUEUED` status:

1. **Check logs for**: `⚠️  Job queue not available`
   - This means Redis isn't connecting
   - Verify `REDIS_URL` or `REDIS_HOST` is set

2. **Check for job processor errors**
   - Look for `[JobProcessor]` in logs
   - May indicate issues with file processing or OpenAI API

3. **Manually trigger job processing** (temporary workaround)
   ```bash
   # In Railway backend service, open Terminal
   node -e "require('./dist/modules/jobs/job.processor').JobProcessor"
   ```

## Cost Considerations

Railway Redis pricing:
- **Free tier**: Development use (may have limits)
- **Pro plan**: ~$5-10/month for small Redis instance

Check Railway pricing page for current rates.

## Alternative: Without Redis

If you don't want to add Redis right now:

1. Jobs will be created but not processed automatically
2. You can implement a manual processing trigger later
3. Or use a simple polling mechanism
4. Or process jobs synchronously (slower but works)

The app will still function - you just won't have background job processing.

## Current Status

✅ Code supports both `REDIS_URL` and `REDIS_HOST`
✅ Queue is optional - app works without Redis
✅ Jobs can be created without queue
⚠️  Jobs won't be processed without Redis

**Recommendation:** Add Redis to Railway for full functionality! It takes 2 minutes and makes the job processing work properly.

