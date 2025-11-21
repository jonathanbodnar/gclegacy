# How to Stop/Cancel Running Jobs

There are several ways to stop or cancel jobs depending on your needs:

## Option 1: Cancel a Specific Job (API)

### Using HTTP Request

**Cancel a single job:**
```bash
# Replace {jobId} with the actual job ID
curl -X DELETE http://localhost:3000/v1/jobs/{jobId} \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example:**
```bash
curl -X DELETE http://localhost:3000/v1/jobs/job-123 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Using the API in Code

```typescript
// In your frontend or API client
await fetch(`/v1/jobs/${jobId}`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## Option 2: Cancel ALL Running Jobs (API)

**Stop all queued and processing jobs:**
```bash
curl -X DELETE http://localhost:3000/v1/jobs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

This will:
- Remove all jobs from the queue
- Update all QUEUED and PROCESSING jobs in the database to CANCELLED status

## Option 3: Cancel Jobs via Database (Direct SQL)

If you need to cancel jobs directly in the database:

```sql
-- Cancel all QUEUED and PROCESSING jobs
UPDATE jobs 
SET status = 'CANCELLED', 
    error = 'Cancelled manually',
    "updatedAt" = NOW()
WHERE status IN ('QUEUED', 'PROCESSING');
```

Or cancel a specific job:
```sql
UPDATE jobs 
SET status = 'CANCELLED', 
    error = 'Cancelled manually',
    "updatedAt" = NOW()
WHERE id = 'your-job-id';
```

## Option 4: Using Prisma Client (Script)

Create a script to cancel jobs:

```typescript
// cancel-jobs.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cancelAllRunningJobs() {
  const result = await prisma.job.updateMany({
    where: {
      status: {
        in: ['QUEUED', 'PROCESSING']
      }
    },
    data: {
      status: 'CANCELLED',
      error: 'Cancelled manually',
    }
  });
  
  console.log(`Cancelled ${result.count} jobs`);
  await prisma.$disconnect();
}

// Cancel specific job
async function cancelJob(jobId: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'CANCELLED',
      error: 'Cancelled manually',
    }
  });
  console.log(`Cancelled job ${jobId}`);
  await prisma.$disconnect();
}

// Run
cancelAllRunningJobs();
// or
// cancelJob('your-job-id');
```

Run it:
```bash
cd backend
npx ts-node cancel-jobs.ts
```

## Option 5: Stop the Application

If you need to stop all processing immediately:

**Stop the NestJS server:**
```bash
# Press Ctrl+C in the terminal where the server is running
# Or kill the process
```

**Find and kill the process:**
```bash
# Windows PowerShell
Get-Process -Name node | Where-Object {$_.Path -like "*backend*"} | Stop-Process

# Or find the PID and kill it
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## Important Notes

1. **Only QUEUED and PROCESSING jobs can be cancelled** - Completed or failed jobs cannot be cancelled
2. **Active processing** - If a job is currently being processed, it will finish its current step before stopping
3. **Queue cleanup** - The cancel method also removes jobs from the Bull queue if Redis is configured
4. **Database updates** - Cancelled jobs are marked with status `CANCELLED` in the database

## Check Job Status

Before cancelling, you can check job status:

```bash
# Get status of a specific job
curl http://localhost:3000/v1/jobs/{jobId} \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Quick Reference

| Method | Use Case | Command |
|--------|----------|---------|
| API - Single Job | Cancel one specific job | `DELETE /v1/jobs/{jobId}` |
| API - All Jobs | Cancel all running jobs | `DELETE /v1/jobs` |
| Database SQL | Direct database update | `UPDATE jobs SET status = 'CANCELLED'...` |
| Prisma Script | Programmatic cancellation | `npx ts-node cancel-jobs.ts` |
| Stop Server | Emergency stop | `Ctrl+C` or kill process |

