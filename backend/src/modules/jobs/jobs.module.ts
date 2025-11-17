import { Module, DynamicModule } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";

import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { JobProcessor } from "./job.processor";
import { IngestModule } from "../ingest/ingest.module";
import { RulesEngineModule } from "../rules-engine/rules-engine.module";
import { VisionModule } from "../vision/vision.module";
import { FilesModule } from "../files/files.module";

// Conditionally include JobProcessor only if Redis is available
const hasRedis = !!(process.env.REDIS_HOST || process.env.REDIS_URL);
const providers = hasRedis 
  ? [JobsService, JobProcessor]
  : [JobsService];

console.log('🔍 JobsModule - Redis configured:', hasRedis);
console.log('   REDIS_HOST:', !!process.env.REDIS_HOST);
console.log('   REDIS_URL:', !!process.env.REDIS_URL);

@Module({
  imports: [
    // Conditionally register Bull queue only if Redis is available
    ...(hasRedis ? [
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
  providers,
  exports: [JobsService],
})
export class JobsModule {}
