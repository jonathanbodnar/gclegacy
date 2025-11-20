# Mock Job for Testing GC Interface

## Created Files
- ✅ `backend/scripts/seed-mock-job.ts` - Seed script
- ✅ `backend/src/seed.controller.ts` - HTTP endpoints
- ✅ Updated `package.json` with npm commands

## How to Create Mock Job

### Option 1: Via Railway Console (Recommended)
1. Go to Railway Dashboard → gclegacy → backend service
2. Open "Shell" or "Console" tab
3. Run:
```bash
npm run seed:mock-job
```

### Option 2: Via HTTP (Once NestJS backend is running)
```bash
curl -X POST https://lovely-mindfulness-development.up.railway.app/seed/mock-job
```

### Option 3: Locally (if you have DATABASE_URL)
```bash
cd "/Users/jonathanbodnar/GC Legacy/backend"
DATABASE_URL="your-database-url" npm run seed:mock-job
```

## What It Creates

**Mock Job ID:** `mock-test-job-001`

**Features:**
- 5 Rooms (3,840 SF total)
- 4 Walls  
- 5 Doors
- 10 Windows
- 5 Pipe runs (880 LF)
- 3 Duct runs
- 11 Fixtures (toilets, sinks, water heaters)
- 8 Materials (flooring, paint, pipe, fittings)

## To Reset and Start Over

```bash
npm run seed:mock-reset  # Deletes mock job
npm run seed:mock-job    # Creates fresh mock job
```

## After Seeding

1. Go to GC Interface: https://gcinterface-development.up.railway.app
2. Navigate to Projects
3. Look for "Mock Commercial Building - MEP Plans.pdf" in Available Takeoffs
4. Click "Import"
5. Test the full workflow!

