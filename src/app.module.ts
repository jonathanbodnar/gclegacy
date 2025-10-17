import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';

import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { TakeoffModule } from './modules/takeoff/takeoff.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { ArtifactsModule } from './modules/artifacts/artifacts.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { RulesEngineModule } from './modules/rules-engine/rules-engine.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60') * 1000,
        limit: parseInt(process.env.RATE_LIMIT_MAX || '100'),
      },
      {
        name: 'medium',
        ttl: 10 * 60 * 1000, // 10 minutes
        limit: 20,
      },
      {
        name: 'long',
        ttl: 60 * 60 * 1000, // 1 hour
        limit: 5,
      },
    ]),

    // Queue management
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),

    // Core modules
    PrismaModule,
    AuthModule,

    // API modules
    FilesModule,
    JobsModule,
    TakeoffModule,
    MaterialsModule,
    ArtifactsModule,
    WebhooksModule,

    // Processing modules
    IngestModule,
    RulesEngineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
