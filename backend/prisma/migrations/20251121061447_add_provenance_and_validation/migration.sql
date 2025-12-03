-- AlterTable
ALTER TABLE "features" ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "validation" JSONB;

-- AlterTable
ALTER TABLE "sheets" ADD COLUMN     "scaleRatio" DOUBLE PRECISION;
