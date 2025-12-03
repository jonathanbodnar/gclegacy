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
        defaultJobOptions: {
          timeout: 3600000, // 60 minute timeout per job
          removeOnComplete: false,
          removeOnFail: false,
        },
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
      
      // Verify processor is registered and listening
      setTimeout(() => {
        if (this.jobProcessor) {
          console.log("✅ JobProcessor is registered and should be listening for 'process-job' jobs");
          console.log("💡 If jobs remain queued, check Railway logs for processor initialization");
        } else {
          console.warn("⚠️  JobProcessor not found - jobs may not process");
        }
      }, 1000);

      // CRITICAL: Reset stuck PROCESSING jobs after backend restart
      setTimeout(async () => {
        try {
          const resetCount = await this.jobsService.resetStuckProcessingJobs();
          if (resetCount > 0) {
            console.log(`🔄 Reset ${resetCount} stuck PROCESSING job(s) back to QUEUED`);
          }
        } catch (error) {
          console.error("Error resetting stuck jobs:", error.message);
        }
      }, 3000); // Check after 3 seconds

      // Fallback: Check for stuck queued jobs and process them after a delay
      // This handles cases where the processor might not be picking up jobs
      setTimeout(async () => {
        try {
          const stuckJobs = await this.jobsService.getStuckQueuedJobs();
          if (stuckJobs.length > 0) {
            console.log(`⚠️  Found ${stuckJobs.length} stuck queued job(s) - processing directly as fallback`);
            for (const job of stuckJobs) {
              // Process directly as fallback
              this.jobsService.processQueuedJobDirectly(job.id).catch((error) => {
                console.error(`Failed to process stuck job ${job.id}:`, error.message);
              });
            }
          }
        } catch (error) {
          console.error("Error checking for stuck jobs:", error.message);
        }
      }, 10000); // Check after 10 seconds
    }
  }
}
