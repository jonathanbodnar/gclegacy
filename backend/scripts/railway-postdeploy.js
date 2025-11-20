#!/usr/bin/env node

/**
 * Railway post-deploy script
 * Runs database migrations and seeding after deployment
 */

const { execSync } = require("child_process");

console.log("🚀 Running Railway post-deploy setup...");

try {
  // Generate Prisma client
  console.log("📦 Generating Prisma client...");
  execSync("npx prisma generate", { stdio: "inherit" });

  // Run database migrations
  console.log("🗄️ Running database migrations...");
  execSync("npx prisma db push", { stdio: "inherit" });

  // Seed the database
  console.log("🌱 Seeding database...");
  execSync("npx ts-node scripts/seed.ts", { stdio: "inherit" });

  console.log("✅ Post-deploy setup completed successfully!");
} catch (error) {
  console.error("❌ Post-deploy setup failed:", error.message);
  process.exit(1);
}
