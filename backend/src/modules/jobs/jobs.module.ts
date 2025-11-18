import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";

import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { JobProcessor } from "./job.processor";
import { IngestModule } from "../ingest/ingest.module";
import { RulesEngineModule } from "../rules-engine/rules-engine.module";
import { VisionModule } from "../vision/vision.module";
import { FilesModule } from "../files/files.module";
import { ScopeDiagnosisModule } from "../scope-diagnosis/scope-diagnosis.module";
import { CostIntelligenceModule } from "../cost-intelligence/cost-intelligence.module";

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
    ScopeDiagnosisModule,
    CostIntelligenceModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobProcessor],
  exports: [JobsService],
})
export class JobsModule {}
