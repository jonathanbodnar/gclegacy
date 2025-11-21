import { Module, OnModuleInit } from "@nestjs/common";
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
export class JobsModule implements OnModuleInit {
  constructor(
    private jobsService: JobsService,
    private jobProcessor: JobProcessor
  ) {}

  async onModuleInit() {
    // Wire up the processor to the service for direct processing when queue is not available
    this.jobsService.setJobProcessor(this.jobProcessor);
    console.log("✅ Job processor initialized and connected to JobsService");

    // If Redis is not available, process any existing queued jobs
    if (
      !process.env.REDIS_HOST &&
      !process.env.REDISHOST &&
      !process.env.REDIS_URL
    ) {
      console.log("⚠️  Redis not detected - will process jobs synchronously");
      // Wait a bit for services to initialize, then process queued jobs
      setTimeout(async () => {
        const count = await this.jobsService.processQueuedJobs();
        if (count > 0) {
          console.log(
            `✅ Started processing ${count} queued job(s) (Redis not available)`
          );
        } else {
          console.log("ℹ️  No queued jobs found to process");
        }
      }, 2000); // Wait 2 seconds for all services to initialize
    } else {
      console.log("✅ Redis detected - jobs will be processed via queue");
      const redisInfo = process.env.REDIS_URL 
        ? `REDIS_URL=${process.env.REDIS_URL.substring(0, 20)}...`
        : `REDIS_HOST=${process.env.REDIS_HOST || process.env.REDISHOST}`;
      console.log(`📡 Redis connection: ${redisInfo}`);
    }
  }
}
