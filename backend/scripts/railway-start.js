#!/usr/bin/env node

/**
 * Railway startup script
 * Handles Railway-specific initialization
 */

const { execSync } = require("child_process");

console.log("🚀 Starting PlanTakeoff API on Railway...");

// Check if this is the first deployment
const isFirstDeploy = !process.env.DATABASE_INITIALIZED;

if (isFirstDeploy) {
  console.log("🔧 First deployment detected, running setup...");

  try {
    // Generate Prisma client
    console.log("📦 Generating Prisma client...");
    execSync("npx prisma generate", { stdio: "inherit" });

    // Push database schema
    console.log("🗄️ Pushing database schema...");
    execSync("npx prisma db push", { stdio: "inherit" });

    // Seed the database
    console.log("🌱 Seeding database with sample data...");
    execSync("node scripts/seed.js", { stdio: "inherit" });

    console.log("✅ Database setup completed!");
  } catch (error) {
    console.error("❌ Database setup failed:", error.message);
    console.log("⚠️ Continuing with application startup...");
  }
}

// Start the application
console.log("🎯 Starting NestJS application...");
require("../dist/main");
