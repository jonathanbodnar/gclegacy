# Extraction Fixes Summary

This document summarizes all the fixes implemented to address the extraction issues.

## Issues Fixed

### ✅ 1. Material Extraction Pipeline
**Problem:** Materials were not being extracted from drawings.

**Solution:**
- Added `materials` array to `VisionAnalysisResult` interface
- Enhanced OpenAI Vision prompts to extract materials from:
  - Wall type legends (PT-1, EXT-1, etc.)
  - Finish schedules
  - Pipe/duct specifications
  - Fixture schedules
- Materials include: type, specification, location, quantity, unit, and source (legend/schedule/callout)
- Materials are extracted during vision analysis and can be processed by the materials service

**Files Changed:**
- `backend/src/modules/vision/openai-vision.service.ts` - Added materials extraction to prompts and interface

### ✅ 2. Scale Extraction Fix
**Problem:** Scale was detected but not properly validated or stored.

**Solution:**
- Enhanced scale extraction with:
  - `confidence` field (high/medium/low)
  - `method` field (titleblock/dimensions/reference/assumed)
  - Better prompt instructions for scale detection
  - Validation of scale ratios
- Added `scaleRatio` field to Sheet schema for numeric calculations
- Scale is now properly stored on sheets with validation

**Files Changed:**
- `backend/src/modules/vision/openai-vision.service.ts` - Enhanced scale extraction
- `backend/prisma/schema.prisma` - Added `scaleRatio` to Sheet model
- `backend/src/modules/vision/feature-extraction.service.ts` - Updates sheet scale on extraction

### ✅ 3. Validation Layer
**Problem:** No validation for unrealistic dimensions.

**Solution:**
- Created `ValidationService` with comprehensive dimension validation:
  - Room area validation (50 - 50,000 sq ft)
  - Wall length validation (1 - 1000 ft)
  - Door/window size validation
  - Pipe diameter and length validation
  - Duct length validation
  - Fixture count validation
  - Geometry validation (polygons, polylines)
- Validation returns: `isValid`, `confidence`, `issues`, `warnings`
- Features are validated before saving to database

**Files Changed:**
- `backend/src/modules/vision/validation.service.ts` - New validation service

### ✅ 4. Provenance (Bounding Boxes, Source Text)
**Problem:** No tracking of where features came from or their confidence.

**Solution:**
- Added `provenance` field to Feature schema (JSON):
  - `extractionMethod`: How the feature was extracted
  - `confidence`: Confidence score (0-1)
  - `timestamp`: When extracted
  - `boundingBox`: Can store bounding box coordinates
  - `sourceText`: Can store source text from drawing
- Provenance is automatically added during feature extraction

**Files Changed:**
- `backend/prisma/schema.prisma` - Added `provenance` and `validation` fields to Feature
- `backend/src/modules/vision/feature-extraction.service.ts` - Adds provenance to features

### ✅ 5. Cross-Sheet Consistency Checks
**Problem:** No validation of consistency across multiple sheets.

**Solution:**
- Created `ConsistencyCheckerService` that checks:
  - Duplicate room names across sheets
  - Scale consistency across sheets
  - Conflicting room data (area/height differences)
  - Missing cross-references (e.g., pipe references non-existent room)
- Returns detailed consistency report with issues and summary

**Files Changed:**
- `backend/src/modules/vision/consistency-checker.service.ts` - New consistency checker

### ✅ 6. Zero-Hallucination Extraction Mode
**Problem:** AI was guessing values instead of only extracting visible data.

**Solution:**
- Added strict mode (`zeroHallucinationMode` or `strictMode` option):
  - Rejects features with validation errors
  - Requires confidence >= 0.7
  - Rejects features missing required provenance
- Enhanced prompts with zero-hallucination instructions:
  - "If a value is not clearly visible, use null or omit it - DO NOT guess"
  - "Dimensions must be read from dimension strings or calculated from scale - never estimated"
  - "Material specifications must be read from legends/schedules - never inferred"
- Features are filtered based on validation results in strict mode

**Files Changed:**
- `backend/src/modules/vision/openai-vision.service.ts` - Added zero-hallucination instructions
- `backend/src/modules/vision/feature-extraction.service.ts` - Implements strict mode filtering

## Schema Changes

### Feature Model
```prisma
model Feature {
  // ... existing fields ...
  
  // Provenance (bounding boxes, source text, confidence)
  provenance Json? // { boundingBox: [[x1,y1], [x2,y2]], sourceText: string, confidence: number, extractionMethod: string }

  // Validation metadata
  validation Json? // { isValid: boolean, confidence: number, issues: [] }
}
```

### Sheet Model
```prisma
model Sheet {
  // ... existing fields ...
  scaleRatio Float?  // Numeric ratio for calculations
}
```

## Usage

### Enable Zero-Hallucination Mode
```typescript
const features = await featureExtractionService.extractFeatures(
  jobId,
  sheetId,
  analysisResult,
  disciplines,
  targets,
  {
    zeroHallucinationMode: true, // or strictMode: true
    checkConsistency: true, // Check cross-sheet consistency
  }
);
```

### Validate Features Manually
```typescript
const validation = validationService.validateFeature(feature, strictMode);
if (!validation.isValid) {
  console.log('Issues:', validation.issues);
}
```

### Check Consistency
```typescript
const report = await consistencyChecker.checkConsistency(jobId);
console.log('Consistency issues:', report.issues);
```

## Testing

Run the test script to validate all fixes:
```bash
cd backend
npx ts-node scripts/test-extraction-fixes.ts
```

## Migration Required

After deploying these changes, run a Prisma migration:
```bash
cd backend
npx prisma migrate dev --name add_provenance_and_validation
```

This will add the `provenance`, `validation`, and `scaleRatio` fields to the database.

## Next Steps

1. **Run Migration**: Apply schema changes to database
2. **Test with Real Data**: Test extraction with actual drawings
3. **Tune Validation Limits**: Adjust dimension limits in `ValidationService` based on real-world data
4. **Monitor Consistency**: Review consistency reports and adjust thresholds
5. **Material Processing**: Integrate extracted materials with materials service for full pipeline

