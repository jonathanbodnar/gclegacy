import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobProcessor } from './job.processor';
import { IngestModule } from '../ingest/ingest.module';
import { RulesEngineModule } from '../rules-engine/rules-engine.module';
import { VisionModule } from '../vision/vision.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'job-processing',
    }),
    IngestModule,
    RulesEngineModule,
    VisionModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobProcessor],
  exports: [JobsService],
})
export class JobsModule {}
