import { Module, DynamicModule } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";

import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { JobProcessor } from "./job.processor";
import { IngestModule } from "../ingest/ingest.module";
import { RulesEngineModule } from "../rules-engine/rules-engine.module";
import { VisionModule } from "../vision/vision.module";
import { FilesModule } from "../files/files.module";

@Module({
  imports: [
    // Conditionally register Bull queue only if Redis is available
    // Support multiple variable name formats: REDIS_URL, REDIS_HOST, REDISHOST
    ...((process.env.REDIS_HOST || process.env.REDISHOST || process.env.REDIS_URL) ? [
      BullModule.registerQueue({
        name: "job-processing",
      })
    ] : []),
    IngestModule,
    RulesEngineModule,
    VisionModule,
    FilesModule,
  ],
  controllers: [JobsController],
  providers: [
    JobsService, 
    JobProcessor, // Always include - @Processor decorator will only activate if queue exists
  ],
  exports: [JobsService],
})
export class JobsModule {
  constructor() {
    const hasRedis = !!(process.env.REDIS_HOST || process.env.REDISHOST || process.env.REDIS_URL);
    console.log('🔍 JobsModule initialized - Redis configured:', hasRedis);
    if (hasRedis) {
      console.log('   Redis vars:', {
        REDIS_HOST: !!process.env.REDIS_HOST,
        REDISHOST: !!process.env.REDISHOST,
        REDIS_URL: !!process.env.REDIS_URL,
      });
    }
  }
}
