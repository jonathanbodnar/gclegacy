#!/usr/bin/env node

/**
 * Resilient Railway startup script
 * Handles graceful startup with retries and fallbacks
 */

const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

const MAX_DB_RETRIES = 30;
const RETRY_DELAY = 2000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠️  DATABASE_URL not set, skipping database checks");
    return false;
  }

  console.log("🔍 Waiting for database to be ready...");

  for (let i = 0; i < MAX_DB_RETRIES; i++) {
    try {
      console.log(`Attempt ${i + 1}/${MAX_DB_RETRIES} - Checking database connection...`);
      
      // Try to connect using prisma
      await execPromise("npx prisma db execute --stdin <<< 'SELECT 1'", {
        timeout: 5000,
      });
      
      console.log("✅ Database is ready!");
      return true;
    } catch (error) {
      console.log(`Database not ready yet (attempt ${i + 1}/${MAX_DB_RETRIES})`);
      
      if (i < MAX_DB_RETRIES - 1) {
        await sleep(RETRY_DELAY);
      }
    }
  }

  console.warn("⚠️  Database connection timeout - continuing anyway");
  return false;
}

async function runMigrations() {
  try {
    console.log("📦 Generating Prisma client...");
    await execPromise("npx prisma generate");

    console.log("🗄️ Running database migrations...");
    await execPromise("npx prisma migrate deploy --skip-seed");
    
    console.log("✅ Migrations completed successfully!");
    return true;
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.warn("⚠️  Continuing without migrations");
    return false;
  }
}

async function startApplication() {
  console.log("🚀 Starting PlanTakeoff API...");
  
  try {
    // Check database availability
    const dbReady = await waitForDatabase();

    // Run migrations only if database is ready
    if (dbReady) {
      await runMigrations();
    } else {
      console.log("⚠️  Starting in minimal mode without database");
      // Set flag to start minimal app
      process.env.MINIMAL_START = "true";
      process.env.SKIP_DB_INIT = "true";
    }

    // Start the NestJS application
    console.log("🎯 Starting NestJS application...");
    require("../dist/main");
  } catch (error) {
    console.error("❌ Startup failed:", error);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("👋 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("👋 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

// Start the application
startApplication().catch((error) => {
  console.error("❌ Fatal error during startup:", error);
  process.exit(1);
});

