import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();

      // Enable PostGIS extension
      try {
        await this.$executeRaw`CREATE EXTENSION IF NOT EXISTS postgis;`;
        console.log("✅ PostGIS extension enabled");
      } catch (postgisError: any) {
        if (
          postgisError?.meta?.code === "0A000" ||
          postgisError?.code === "P2010"
        ) {
          console.error(
            "❌ PostGIS extension is not available in this PostgreSQL instance."
          );
          console.error(
            "⚠️  This application requires PostGIS for geospatial features."
          );
          console.error(
            "💡 Solution: Use a PostGIS-enabled PostgreSQL image (e.g., postgis/postgis:15-3.4)"
          );
          console.error(
            "💡 On Railway: Use the PostGIS template or container service instead of managed PostgreSQL"
          );
          throw new Error(
            "PostGIS extension is required but not available. Please use a PostGIS-enabled PostgreSQL instance."
          );
        }
        throw postgisError;
      }

      // Verify that required tables exist (safety check)
      const tables = await this.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'files';
      `;

      if (tables.length === 0) {
        console.error(
          '❌ Database schema not initialized! The "files" table does not exist.'
        );
        console.error("⚠️  Please run: npx prisma migrate deploy");
        throw new Error(
          "Database schema not initialized. Run migrations first."
        );
      }

      console.log("✅ Database connection established and schema verified");
    } catch (error) {
      console.error("❌ Database initialization failed:", error.message);
      // In production, fail fast if database is not ready
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      // In development, allow the app to start for health checks
      console.warn("⚠️  Continuing without database (development mode)");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Helper method to execute raw geometry queries
  async executeGeometryQuery(query: string, params: any[] = []) {
    return this.$queryRawUnsafe(query, ...params);
  }

  // Helper to calculate area from PostGIS geometry
  async calculateArea(
    geometryColumn: string,
    tableName: string,
    whereClause?: string
  ) {
    const query = `
      SELECT ST_Area(${geometryColumn}) as area
      FROM ${tableName}
      ${whereClause ? `WHERE ${whereClause}` : ""}
    `;
    return this.$queryRawUnsafe(query);
  }

  // Helper to calculate length from PostGIS geometry
  async calculateLength(
    geometryColumn: string,
    tableName: string,
    whereClause?: string
  ) {
    const query = `
      SELECT ST_Length(${geometryColumn}) as length
      FROM ${tableName}
      ${whereClause ? `WHERE ${whereClause}` : ""}
    `;
    return this.$queryRawUnsafe(query);
  }
}
