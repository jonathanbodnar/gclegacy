import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";

import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { JobProcessor } from "./job.processor";
import { IngestModule } from "../ingest/ingest.module";
import { RulesEngineModule } from "../rules-engine/rules-engine.module";
import { VisionModule } from "../vision/vision.module";
import { FilesModule } from "../files/files.module";

// Make Bull queue optional - only register if Redis is available
const conditionalImports = [
  IngestModule,
  RulesEngineModule,
  VisionModule,
  FilesModule,
];

if (process.env.REDIS_HOST) {
  conditionalImports.unshift(
    BullModule.registerQueue({
      name: "job-processing",
    })
  );
}

@Module({
  imports: conditionalImports,
  controllers: [JobsController],
  providers: [JobsService, JobProcessor],
  exports: [JobsService],
})
export class JobsModule {}
