-- Align features.geom with Prisma schema (JSONB instead of PostGIS geometry)
ALTER TABLE "features" DROP COLUMN IF EXISTS "geom";
ALTER TABLE "features" ADD COLUMN "geom" JSONB;
