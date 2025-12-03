# Quick Start: Complete the Extraction Fixes

## Current Status

✅ **Code Changes Complete** - All fixes are implemented in code
⚠️ **Database Migration Needed** - Schema changes need to be applied to database
⚠️ **Prisma Client Regeneration** - Need to regenerate Prisma client

## Steps to Complete Setup

### 1. Run Database Migration

The schema has been updated with new fields, but they need to be added to the database:

```bash
cd backend
npx prisma migrate dev --name add_provenance_and_validation
```

This will:

- Add `provenance` and `validation` JSON fields to `features` table
- Add `scaleRatio` Float field to `sheets` table

### 2. Regenerate Prisma Client

After migration, regenerate the Prisma client to get TypeScript types:

```bash
cd backend
npx prisma generate
```

### 3. Run Test Script

Verify all fixes are working:

```bash
cd backend
npx ts-node scripts/test-extraction-fixes.ts
```

Expected: All 9 tests should pass (or at least 7-8, with schema tests passing after migration)

## What Was Fixed

1. ✅ **Material Extraction** - Added to vision prompts and interface
2. ✅ **Scale Extraction** - Enhanced with confidence and method tracking
3. ✅ **Validation Layer** - Created ValidationService with dimension checks
4. ✅ **Provenance Tracking** - Added provenance and validation fields to schema
5. ✅ **Cross-Sheet Consistency** - Created ConsistencyCheckerService
6. ✅ **Zero-Hallucination Mode** - Added strict mode with validation filtering

## Known Issues (Will Resolve After Migration)

- Test script may show database column errors until migration is run
- TypeScript may show type errors until Prisma client is regenerated
- These are expected and will resolve after steps 1-2 above

## Usage Example

Once migration is complete, you can use the new features:

```typescript
// Enable zero-hallucination mode
const features = await featureExtractionService.extractFeatures(
  jobId,
  sheetId,
  analysisResult,
  disciplines,
  targets,
  {
    zeroHallucinationMode: true, // Rejects uncertain values
    checkConsistency: true, // Checks cross-sheet consistency
  }
);

// Check consistency manually
const report = await consistencyChecker.checkConsistency(jobId);
console.log("Consistency issues:", report.issues);

// Validate a feature
const validation = validationService.validateFeature(feature, true);
if (!validation.isValid) {
  console.log("Issues:", validation.issues);
}
```

## Files Changed

- `backend/prisma/schema.prisma` - Added provenance, validation, scaleRatio
- `backend/src/modules/vision/validation.service.ts` - NEW
- `backend/src/modules/vision/consistency-checker.service.ts` - NEW
- `backend/src/modules/vision/openai-vision.service.ts` - Enhanced prompts
- `backend/src/modules/vision/feature-extraction.service.ts` - Integrated validation
- `backend/src/modules/vision/vision.module.ts` - Registered new services

## Next Steps After Migration

1. Test with real drawings
2. Tune validation limits in `ValidationService` based on your data
3. Monitor consistency reports
4. Integrate extracted materials with materials service
