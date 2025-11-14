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

      // Diagnostic: Check database connection details (without exposing password)
      const dbUrl = process.env.DATABASE_URL || "";
      const dbHost = dbUrl.match(/@([^:]+):/)?.[1] || "unknown";
      const dbName = dbUrl.match(/\/([^?]+)/)?.[1] || "unknown";
      console.log(`🔍 Database connection: ${dbHost}/${dbName}`);

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
}
