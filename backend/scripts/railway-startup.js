#!/usr/bin/env node

/**
 * Railway startup script
 * Runs database migrations before starting the application
 */

const { execSync } = require("child_process");

console.log("🚀 Starting PlanTakeoff API on Railway...");

try {
  // Run database migrations
  console.log("🗄️  Running database migrations...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("✅ Database migrations completed successfully");
} catch (error) {
  // Check if it's a connection error (database not ready yet)
  if (error.message && error.message.includes("Can't reach database server")) {
    console.error("❌ Cannot connect to database during startup.");
    console.error(
      "⚠️  Database might not be ready yet. The app will start and PrismaService will retry."
    );
    // Continue - PrismaService will handle connection retries
  } else {
    console.error("❌ Database migration failed:", error.message);
    console.error(
      "⚠️  Continuing anyway. PrismaService will verify schema on startup."
    );
    // Continue - PrismaService will verify the schema exists
  }
}

// Start the application
console.log("🎯 Starting NestJS application...");
require("../dist/main");
