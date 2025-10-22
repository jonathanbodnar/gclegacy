import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';

// Conditionally import modules based on environment
const conditionalImports = [];

// Add PrismaModule if DATABASE_URL is available
if (process.env.DATABASE_URL) {
  try {
    const { PrismaModule } = require('./common/prisma/prisma.module');
    conditionalImports.push(PrismaModule);
  } catch (error) {
    console.warn('PrismaModule not available:', error.message);
  }
}

// Add VisionModule if OpenAI is configured
if (process.env.OPENAI_API_KEY) {
  try {
    const { VisionModule } = require('./modules/vision/vision.module');
    conditionalImports.push(VisionModule);
  } catch (error) {
    console.warn('VisionModule not available:', error.message);
  }
}

// Minimal app module for faster startup and health checks
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
    }),
    ...conditionalImports,
  ],
  controllers: [HealthController],
})
export class MinimalAppModule {
  constructor() {
    console.log('🏗️ MinimalAppModule loaded with modules:', conditionalImports.map(m => m.name));
  }
}
